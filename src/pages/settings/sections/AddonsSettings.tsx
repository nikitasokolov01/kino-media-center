// Settings > Addons — renders the shared AddonManager component.

import AddonManager from "../../../components/AddonManager.js";

export default function AddonsSettings() {
  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">Addons</h2>
      <AddonManager />
    </div>
  );
}
