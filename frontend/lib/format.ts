export function formatINR(amount: number, compact: boolean = false): string {
  if (amount === undefined || amount === null || isNaN(amount)) return "₹0";

  if (compact && amount >= 100000) {
    const lakhs = amount / 100000;
    return `₹${lakhs.toFixed(2)}L`;
  }

  if (compact && amount >= 1000) {
    const k = amount / 1000;
    return `₹${k.toFixed(1)}k`;
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPct(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return "0%";
  const pct = val > 1 ? val : val * 100;
  return `${pct.toFixed(1)}%`;
}

export function formatTimeAgo(isoString: string): string {
  if (!isoString) return "just now";
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
