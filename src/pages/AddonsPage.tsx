// Standalone /addons route — thin wrapper around the shared AddonManager component.
// The same AddonManager renders in Settings > Addons via AddonsSettings.tsx.

import AddonManager from "../components/AddonManager.js";

export default function AddonsPage() {
  return (
    <div className="page">
      <h1>Addons</h1>
      <AddonManager />
    </div>
  );
}
