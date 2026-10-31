"""
Synthetic transaction data generator for Revenue Autopilot.

Generates realistic Razorpay-style transaction data across four leak categories:
- failed_payment
- abandoned_checkout
- failed_subscription
- overdue_invoice
"""
import random
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd

RNG_SEED = 42
random.seed(RNG_SEED)
np.random.seed(RNG_SEED)

PAYMENT_METHODS = ["card", "upi", "netbanking", "wallet", "emi"]
FAILURE_CODES = {
    "card": ["insufficient_funds", "card_declined", "expired_card", "issuer_timeout", "3ds_failed"],
    "upi": ["upi_timeout", "insufficient_funds", "invalid_vpa", "psp_down"],
    "netbanking": ["bank_timeout", "session_expired", "insufficient_funds"],
    "wallet": ["insufficient_balance", "wallet_limit_exceeded"],
    "emi": ["emi_not_approved", "issuer_timeout"],
}
MERCHANT_SEGMENTS = ["d2c_retail", "saas", "marketplace", "education", "travel"]

N_CUSTOMERS = 3200


def _make_customers(n=N_CUSTOMERS):
    customers = []
    for i in range(n):
        prior_successes = int(np.random.exponential(scale=3))
        prior_successes = min(prior_successes, 40)
        ltv_bucket = "high" if prior_successes >= 8 else ("medium" if prior_successes >= 3 else "low")
        preferred_method = random.choice(PAYMENT_METHODS)
        customers.append({
            "customer_id": f"cust_{i:05d}",
            "prior_successful_payments": prior_successes,
            "ltv_bucket": ltv_bucket,
            "preferred_method": preferred_method,
            "signup_days_ago": random.randint(5, 900),
        })
    return pd.DataFrame(customers)


def _gen_failed_payments(customers, n, merchant_id="merch_001"):
    rows = []
    now = datetime.now(timezone.utc)
    for i in range(n):
        cust = customers.sample(1).iloc[0]
        method = cust["preferred_method"] if random.random() < 0.75 else random.choice(PAYMENT_METHODS)
        failure_code = random.choice(FAILURE_CODES[method])
        amount = round(float(np.clip(np.random.lognormal(mean=7.6, sigma=0.9), 199, 95000)), 2)
        hours_since_failure = random.randint(1, 96)
        retries_so_far = np.random.choice([0, 1, 2, 3], p=[0.55, 0.28, 0.12, 0.05])
        leak_id = f"fp_{len(rows):06d}"
        rows.append({
            "transaction_id": f"tx_{leak_id}",
            "leak_id": leak_id,
            "merchant_id": merchant_id,
            "customer_id": cust["customer_id"],
            "amount": amount,
            "leak_type": "failed_payment",
            "payment_method": method,
            "failure_code": failure_code,
            "prior_successful_payments": cust["prior_successful_payments"],
            "ltv_bucket": cust["ltv_bucket"],
            "retries_so_far": int(retries_so_far),
            "hours_since_event": hours_since_failure,
            "age_days": 0,
            "event_time": (now - timedelta(hours=hours_since_failure)).isoformat(),
            "merchant_segment": random.choice(MERCHANT_SEGMENTS),
            "payment_id": f"pay_{i:08d}",
        })
    return rows


def _gen_abandoned_checkouts(customers, n, merchant_id="merch_001"):
    rows = []
    now = datetime.now(timezone.utc)
    for i in range(n):
        cust = customers.sample(1).iloc[0]
        amount = round(float(np.clip(np.random.lognormal(mean=6.9, sigma=1.0), 99, 60000)), 2)
        visits = np.random.choice([1, 2, 3, 5, 8, 11], p=[0.35, 0.25, 0.15, 0.12, 0.08, 0.05])
        hours_since = random.randint(1, 120)
        reached_payment_page = random.random() < 0.4
        leak_id = f"ac_{len(rows):06d}"
        rows.append({
            "transaction_id": f"tx_{leak_id}",
            "leak_id": leak_id,
            "merchant_id": merchant_id,
            "customer_id": cust["customer_id"],
            "amount": amount,
            "leak_type": "abandoned_checkout",
            "payment_method": random.choice(PAYMENT_METHODS),
            "failure_code": "abandoned_at_payment" if reached_payment_page else "abandoned_at_cart",
            "prior_successful_payments": cust["prior_successful_payments"],
            "ltv_bucket": cust["ltv_bucket"],
            "retries_so_far": 0,
            "hours_since_event": hours_since,
            "age_days": 0,
            "event_time": (now - timedelta(hours=hours_since)).isoformat(),
            "merchant_segment": random.choice(MERCHANT_SEGMENTS),
            "visit_count": int(visits),
            "reached_payment_page": reached_payment_page,
            "payment_id": None,
        })
    return rows


def _gen_failed_subscriptions(customers, n, merchant_id="merch_001"):
    rows = []
    now = datetime.now(timezone.utc)
    for i in range(n):
        cust = customers.sample(1).iloc[0]
        amount = round(float(np.clip(np.random.lognormal(mean=6.5, sigma=0.6), 149, 15000)), 2)
        sub_age_days = random.randint(15, 720)
        consecutive_failures = np.random.choice([1, 2, 3, 4], p=[0.5, 0.28, 0.14, 0.08])
        hours_since = random.randint(1, 72)
        leak_id = f"fs_{len(rows):06d}"
        rows.append({
            "transaction_id": f"tx_{leak_id}",
            "leak_id": leak_id,
            "merchant_id": merchant_id,
            "customer_id": cust["customer_id"],
            "amount": amount,
            "leak_type": "failed_subscription",
            "payment_method": random.choice(PAYMENT_METHODS),
            "failure_code": "mandate_failed" if random.random() < 0.4 else "renewal_declined",
            "prior_successful_payments": cust["prior_successful_payments"],
            "ltv_bucket": cust["ltv_bucket"],
            "retries_so_far": int(consecutive_failures - 1),
            "consecutive_failures": int(consecutive_failures),
            "hours_since_event": hours_since,
            "age_days": 0,
            "subscription_age_days": sub_age_days,
            "event_time": (now - timedelta(hours=hours_since)).isoformat(),
            "merchant_segment": random.choice(MERCHANT_SEGMENTS),
            "payment_id": f"sub_pay_{i:08d}",
        })
    return rows


def _gen_overdue_invoices(customers, n, merchant_id="merch_001"):
    rows = []
    now = datetime.now(timezone.utc)
    for i in range(n):
        cust = customers.sample(1).iloc[0]
        amount = round(float(np.clip(np.random.lognormal(mean=8.0, sigma=0.8), 999, 150000)), 2)
        age_days = random.randint(1, 60)
        leak_id = f"oi_{len(rows):06d}"
        rows.append({
            "transaction_id": f"tx_{leak_id}",
            "leak_id": leak_id,
            "merchant_id": merchant_id,
            "customer_id": cust["customer_id"],
            "amount": amount,
            "leak_type": "overdue_invoice",
            "payment_method": random.choice(PAYMENT_METHODS),
            "failure_code": "invoice_overdue",
            "prior_successful_payments": cust["prior_successful_payments"],
            "ltv_bucket": cust["ltv_bucket"],
            "retries_so_far": 0,
            "hours_since_event": age_days * 24,
            "age_days": age_days,
            "event_time": (now - timedelta(days=age_days)).isoformat(),
            "merchant_segment": random.choice(MERCHANT_SEGMENTS),
            "payment_id": f"inv_{i:08d}",
        })
    return rows


def _recovery_label(row):
    p = 0.5
    p += 0.03 * min(row["prior_successful_payments"], 15)
    p -= 0.10 * row["retries_so_far"]
    p -= 0.002 * row["hours_since_event"]
    p -= 0.000006 * row["amount"]

    if row["leak_type"] == "failed_payment":
        if row["failure_code"] in ("insufficient_funds", "issuer_timeout", "bank_timeout", "psp_down", "upi_timeout"):
            p += 0.12
        if row["failure_code"] in ("card_declined", "expired_card", "invalid_vpa"):
            p -= 0.15
    elif row["leak_type"] == "abandoned_checkout":
        p -= 0.05 * min(row.get("visit_count", 1) - 1, 5) * 0.3
        if row.get("reached_payment_page"):
            p += 0.15
    elif row["leak_type"] == "failed_subscription":
        p -= 0.15 * (row.get("consecutive_failures", 1) - 1)
    elif row["leak_type"] == "overdue_invoice":
        p -= 0.01 * row["age_days"]

    p = float(np.clip(p, 0.03, 0.97))
    return 1 if random.random() < p else 0, p


def generate_dataset(n_total=10000, seed=RNG_SEED, merchant_id="merch_001"):
    random.seed(seed)
    np.random.seed(seed)
    customers = _make_customers()

    n_fp = int(n_total * 0.34)
    n_ac = int(n_total * 0.24)
    n_fs = int(n_total * 0.20)
    n_oi = n_total - n_fp - n_ac - n_fs

    rows = (
        _gen_failed_payments(customers, n_fp, merchant_id)
        + _gen_abandoned_checkouts(customers, n_ac, merchant_id)
        + _gen_failed_subscriptions(customers, n_fs, merchant_id)
        + _gen_overdue_invoices(customers, n_oi, merchant_id)
    )
    df = pd.DataFrame(rows)

    labels, true_probs = [], []
    for _, row in df.iterrows():
        y, p = _recovery_label(row)
        labels.append(y)
        true_probs.append(p)
    df["recovered_ground_truth"] = labels
    df["true_recovery_prob"] = true_probs

    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    return df, customers
