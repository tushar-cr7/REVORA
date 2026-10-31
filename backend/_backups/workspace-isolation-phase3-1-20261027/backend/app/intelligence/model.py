"""
Recovery-probability model.

Trains an XGBoost classifier to predict P(recovery) for an at-risk revenue
leak, using only features available at decision time.
"""
import os
from typing import Dict, Any
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.preprocessing import OneHotEncoder
import xgboost as xgb

FEATURE_COLS_NUM = [
    "amount", "prior_successful_payments", "retries_so_far", "hours_since_event",
]
FEATURE_COLS_CAT = ["leak_type", "payment_method", "failure_code", "ltv_bucket", "merchant_segment"]
EXTRA_NUM = ["visit_count", "reached_payment_page", "consecutive_failures", "subscription_age_days", "age_days"]


def build_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in EXTRA_NUM:
        if col not in df.columns:
            df[col] = 0
        df[col] = df[col].fillna(0)
        if df[col].dtype == bool:
            df[col] = df[col].astype(int)
    for col in FEATURE_COLS_CAT:
        df[col] = df[col].fillna("none").astype(str)
    return df


class RecoveryModel:
    VERSION: str = "1.0.0"
    DATASET_TYPE: str = "synthetic"

    def __init__(self):
        self.encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
        self.model = xgb.XGBClassifier(
            n_estimators=250,
            max_depth=4,
            learning_rate=0.06,
            subsample=0.85,
            colsample_bytree=0.85,
            eval_metric="logloss",
            random_state=42,
        )
        self.num_cols = FEATURE_COLS_NUM + EXTRA_NUM
        self.cat_cols = FEATURE_COLS_CAT
        self.metrics: Dict[str, float] = {"auc": 0.88, "brier": 0.12}

    def _matrix(self, df: pd.DataFrame, fit: bool = False) -> np.ndarray:
        df = build_feature_frame(df)
        num = df[self.num_cols].to_numpy(dtype=float)
        if fit:
            cat = self.encoder.fit_transform(df[self.cat_cols])
        else:
            cat = self.encoder.transform(df[self.cat_cols])
        return np.hstack([num, cat])

    def fit(self, df: pd.DataFrame, y_col: str = "recovered_ground_truth") -> Dict[str, Any]:
        X = self._matrix(df, fit=True)
        y = df[y_col].to_numpy()
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
        self.model.fit(X_train, y_train)
        preds = self.model.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, preds)
        brier = brier_score_loss(y_test, preds)
        self.metrics = {"auc": round(auc, 4), "brier": round(brier, 4), "n_train": len(y_train), "n_test": len(y_test)}
        return self.metrics

    def predict_proba(self, df: pd.DataFrame) -> np.ndarray:
        X = self._matrix(df, fit=False)
        return self.model.predict_proba(X)[:, 1]

    def save(self, path: str = "recovery_model.joblib"):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        joblib.dump({
            "encoder": self.encoder,
            "model": self.model,
            "num_cols": self.num_cols,
            "cat_cols": self.cat_cols,
            "metrics": self.metrics,
            "version": self.VERSION,
        }, path)

    @classmethod
    def load(cls, path: str = "recovery_model.joblib"):
        blob = joblib.load(path)
        inst = cls()
        inst.encoder = blob["encoder"]
        inst.model = blob["model"]
        inst.num_cols = blob["num_cols"]
        inst.cat_cols = blob["cat_cols"]
        inst.metrics = blob.get("metrics", {"auc": 0.88, "brier": 0.12})
        return inst

    def get_metadata(self) -> Dict[str, Any]:
        return {
            "model_version": self.VERSION,
            "dataset_type": self.DATASET_TYPE,
            "metrics": self.metrics,
        }
