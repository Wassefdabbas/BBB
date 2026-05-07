import numpy as np
import joblib
from pathlib import Path

# from fastapi import FastAPI, HTTPException
from fastapi import FastAPI, HTTPException, Query

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.nn import GATConv, global_mean_pool, global_max_pool

from rdkit import Chem
from rdkit.Chem import Descriptors, rdMolDescriptors
from rdkit.Chem import rdchem
import warnings
warnings.filterwarnings('ignore')

# Add these imports at the top
import io
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from rdkit.Chem.Draw import rdMolDraw2D

# ── App setup ──────────────────────────────────────────────────────────────────
app = FastAPI(title="BBBP Predictor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Featurization Logic ────────────────────────────────────────────────────────
def one_hot(val, choices):
    return [int(val == c) for c in choices]

ATOM_TYPES  = [6, 7, 8, 9, 15, 16, 17, 35, 53, 0]
DEGREE_LIST = [0, 1, 2, 3, 4, 5]
HCOUNT_LIST = [0, 1, 2, 3, 4]
CHARGE_LIST = [-1, -2, 1, 2, 0]

def atom_features(atom):
    return (
        one_hot(atom.GetAtomicNum(), ATOM_TYPES)
        + one_hot(atom.GetDegree(), DEGREE_LIST)
        + one_hot(atom.GetTotalNumHs(), HCOUNT_LIST)
        + one_hot(atom.GetFormalCharge(), CHARGE_LIST)
        + [int(atom.GetIsAromatic())]
    )

BOND_TYPES = [
    rdchem.BondType.SINGLE,
    rdchem.BondType.DOUBLE,
    rdchem.BondType.TRIPLE,
    rdchem.BondType.AROMATIC,
]

def bond_features(bond):
    return one_hot(bond.GetBondType(), BOND_TYPES) + [int(bond.IsInRing())]

def molecular_descriptors(mol):
    return [
        Descriptors.MolWt(mol),
        Descriptors.MolLogP(mol),
        Descriptors.TPSA(mol),
        Descriptors.NumHDonors(mol),
        Descriptors.NumHAcceptors(mol),
        Descriptors.NumRotatableBonds(mol),
        rdMolDescriptors.CalcNumRings(mol),
        rdMolDescriptors.CalcNumAromaticRings(mol),
        Descriptors.FractionCSP3(mol),
        Descriptors.BertzCT(mol),
        Descriptors.NHOHCount(mol),
        Descriptors.NOCount(mol),
        Descriptors.MolMR(mol),
        Descriptors.HeavyAtomCount(mol),
        Descriptors.Chi0n(mol),
        Descriptors.Kappa1(mol),
        rdMolDescriptors.CalcNumHeteroatoms(mol),
        rdMolDescriptors.CalcNumSaturatedRings(mol),
        Descriptors.MaxPartialCharge(mol),
        Descriptors.MinPartialCharge(mol),
    ]

NODE_FEATURES = 27
EDGE_FEATURES = 5
NUM_DESCRIPTORS = 20

# ── Feature extraction ─────────────────────────────────────────────────────────
def smiles_to_graph(smiles: str, scaler):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    # Node features
    x = torch.tensor([atom_features(a) for a in mol.GetAtoms()], dtype=torch.float)

    # Edge features
    rows, cols, edge_attrs = [], [], []
    for bond in mol.GetBonds():
        i, j = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        bf = bond_features(bond)
        rows += [i, j, j, i]
        edge_attrs += [bf, bf]
        cols += [j, i, i, j] # Wait, this creates duplicates.

    # Correct edge features
    rows, cols, edge_attrs = [], [], []
    for bond in mol.GetBonds():
        i, j = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        bf = bond_features(bond)
        rows += [i, j]
        cols += [j, i]
        edge_attrs += [bf, bf]
        
    edge_index = torch.tensor([rows, cols], dtype=torch.long)
    if float(torch.__version__[:3]) <= 1.5:
        # Just in case edge_index is empty
        if len(rows) == 0:
            edge_index = torch.empty((2, 0), dtype=torch.long)

    edge_attr = torch.tensor(edge_attrs, dtype=torch.float)
    if len(edge_attrs) == 0:
        edge_attr = torch.empty((0, EDGE_FEATURES), dtype=torch.float)

    # Descriptors
    desc = molecular_descriptors(mol)
    try:
        # Some descriptors might be None/NaN, handle them
        if any(np.isnan(desc)) or any(np.isinf(desc)):
            desc = np.nan_to_num(desc)
    except:
        pass
    
    desc_scaled = scaler.transform(np.array(desc, dtype=np.float32).reshape(1, -1))
    descriptors = torch.tensor(desc_scaled, dtype=torch.float)

    return Data(x=x, edge_index=edge_index, edge_attr=edge_attr, descriptors=descriptors)

# ── Load models ────────────────────────────────────────────────────────────────
MODEL_DIR = Path(__file__).parent / 'models'

try:
    scaler = joblib.load(MODEL_DIR / 'scaler.pkl')
except FileNotFoundError as e:
    raise RuntimeError(f"Scaler file not found in {MODEL_DIR}") from e

# ── Model Architecture ─────────────────────────────────────────────────────────

GAT_HEADS = 4
HIDDEN    = 128

class HybridGAT(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = GATConv(NODE_FEATURES, HIDDEN, heads=GAT_HEADS, concat=False, edge_dim=EDGE_FEATURES, dropout=0.1)
        self.conv2 = GATConv(HIDDEN, HIDDEN, heads=GAT_HEADS, concat=False, edge_dim=EDGE_FEATURES, dropout=0.1)
        self.conv3 = GATConv(HIDDEN, HIDDEN, heads=GAT_HEADS, concat=False, edge_dim=EDGE_FEATURES, dropout=0.1)
        self.conv4 = GATConv(HIDDEN, HIDDEN, heads=GAT_HEADS, concat=False, edge_dim=EDGE_FEATURES, dropout=0.1)

        self.bn1 = nn.BatchNorm1d(HIDDEN)
        self.bn2 = nn.BatchNorm1d(HIDDEN)
        self.bn3 = nn.BatchNorm1d(HIDDEN)
        self.bn4 = nn.BatchNorm1d(HIDDEN)

        self.fc1 = nn.Linear(HIDDEN * 2 + NUM_DESCRIPTORS, 128)
        self.bn_fc = nn.BatchNorm1d(128)
        self.fc2 = nn.Linear(128, 64)
        self.fc3 = nn.Linear(64, 1)

    def forward(self, x, edge_index, edge_attr, batch, descriptors):
        h  = F.elu(self.bn1(self.conv1(x, edge_index, edge_attr=edge_attr)))
        h2 = F.elu(self.bn2(self.conv2(h, edge_index, edge_attr=edge_attr)))
        h  = h + h2
        h3 = F.elu(self.bn3(self.conv3(h, edge_index, edge_attr=edge_attr)))
        h  = h + h3
        h  = F.elu(self.bn4(self.conv4(h, edge_index, edge_attr=edge_attr)))

        g_mean = global_mean_pool(h, batch)
        g_max  = global_max_pool(h, batch)
        g      = torch.cat([g_mean, g_max], dim=1)

        desc = descriptors.view(-1, NUM_DESCRIPTORS)
        combined = torch.cat([g, desc], dim=1)

        out = F.elu(self.bn_fc(self.fc1(combined)))
        out = F.elu(self.fc2(out))
        out = torch.sigmoid(self.fc3(out))
        return out

device = torch.device('cpu') # Run API on CPU for simplicity
model = HybridGAT().to(device)
try:
    state_dict = torch.load(MODEL_DIR / 'best_hybrid_gat.pt', map_location=device)
    # The saved state dictionary uses names like 'conv1.weight' because they were saved as a dictionary of separate Module parameters rather than a single Module in the notebook.
    # We must construct a dictionary mapped to the HybridGAT state.
    # The notebook saved: {'conv1': conv1.state_dict(), 'bn1': bn1.state_dict(), ...}
    processed_state_dict = {}
    for module_name, mod_state in state_dict.items():
        for param_name, param_tensor in mod_state.items():
            processed_state_dict[f'{module_name}.{param_name}'] = param_tensor
    
    model.load_state_dict(processed_state_dict)
    model.eval()
except Exception as e:
    raise RuntimeError(f"Failed to load model weights: {e}")

# ── Schemas ────────────────────────────────────────────────────────────────────
class PredictRequest(BaseModel):
    smiles: str

class PredictResponse(BaseModel):
    smiles: str
    prediction: int
    label: str
    probability_bbb_plus: float
    probability_bbb_minus: float

# @app.get("/depict")
# def depict(smiles: str = Query(...)):
#     mol = Chem.MolFromSmiles(smiles)
#     if mol is None:
#         raise HTTPException(status_code=422, detail=f"Invalid SMILES: {smiles}")

#     drawer = rdMolDraw2D.MolDraw2DSVG(300, 300)
#     drawer.drawOptions().clearBackground = True
#     drawer.drawOptions().bondLineWidth = 2.0
#     drawer.DrawMolecule(mol)
#     drawer.FinishDrawing()
#     svg = drawer.GetDrawingText()

#     return Response(content=svg, media_type="image/svg+xml")

# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get('/')
def root():
    return {'status': 'ok', 'message': 'BBBP Predictor API is running (Hybrid GAT model)'}

@app.get('/health')
def health():
    return {'status': 'healthy'}

@app.post('/predict', response_model=PredictResponse)
def predict(body: PredictRequest):
    smiles = body.smiles.strip()
    if not smiles:
        raise HTTPException(status_code=400, detail='SMILES string cannot be empty')

    # Parse and generate features
    data = smiles_to_graph(smiles, scaler)
    if data is None:
        raise HTTPException(status_code=422, detail=f'Invalid SMILES: {smiles}')

    # Predict
    with torch.no_grad():
        x = data.x.to(device)
        edge_index = data.edge_index.to(device)
        edge_attr = data.edge_attr.to(device)
        descriptors = data.descriptors.to(device)
        batch = torch.zeros(x.size(0), dtype=torch.long, device=device)
        
        prob = model(x, edge_index, edge_attr, batch, descriptors).item()

    pred = 1 if prob >= 0.5 else 0
    return PredictResponse(
        smiles=smiles,
        prediction=pred,
        label='BBB+' if pred == 1 else 'BBB-',
        probability_bbb_plus=prob,
        probability_bbb_minus=1.0 - prob
    )
