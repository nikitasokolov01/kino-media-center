// Settings > About — app info and build details.

export default function AboutSettings() {
  return (
    <div className="settings-panel">
      <h2 className="settings-panel__title">About</h2>

      <section className="settings-section">
        <h3 className="settings-section__label">Media Center App</h3>
        <p className="muted small">
          A Stremio-compatible media center built with Electron, React,
          TypeScript, and Vite. Addons are installed from their manifest URLs
          and stream sources are fetched at playback time -- no hardcoded
          providers.
        </p>
        <table className="about-table">
          <tbody>
            <tr>
              <td className="about-table__key muted small">Version</td>
              <td className="about-table__val small">MVP (development)</td>
            </tr>
            <tr>
              <td className="about-table__key muted small">Runtime</td>
              <td className="about-table__val small">
                Electron + Chromium (Vite renderer)
              </td>
            </tr>
            <tr>
              <td className="about-table__key muted small">Database</td>
              <td className="about-table__val small">
                SQLite via better-sqlite3 (local userData)
              </td>
            </tr>
            <tr>
              <td className="about-table__key muted small">External player</td>
              <td className="about-table__val small">MPV (user-installed)</td>
            </tr>
            <tr>
              <td className="about-table__key muted small">Addon protocol</td>
              <td className="about-table__val small">
                Stremio addon manifest (manifest.json)
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="settings-section">
        <h3 className="settings-section__label">Resources</h3>
        <div className="about-links">
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              void window.mediaCenter.system.openExternal(
                "https://mpv.io/installation/",
              )
            }
          >
            Install MPV
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() =>
              void window.mediaCenter.system.openExternal(
                "https://stremio.com/",
              )
            }
          >
            Stremio addon ecosystem
          </button>
        </div>
      </section>
    </div>
  );
}
