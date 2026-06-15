// Custom Theme Builder: lets users define named colour themes via colour pickers,
// preview them inline, and save/apply/delete presets stored in app_settings.

import { useState, useCallback } from "react";
import { useSettings } from "../../../state/SettingsContext.js";

export interface CustomThemePreset {
  id: string;
  name: string;
  vars: Record<string, string>;
}

const CSS_VARS: { key: string; label: string }[] = [
  { key: "--color-bg",           label: "Background" },
  { key: "--color-bg-elevated",  label: "Elevated BG" },
  { key: "--color-surface",      label: "Surface" },
  { key: "--color-surface-hover",label: "Surface Hover" },
  { key: "--color-border",       label: "Border" },
  { key: "--color-text",         label: "Primary Text" },
  { key: "--color-text-muted",   label: "Muted Text" },
  { key: "--color-accent",       label: "Accent" },
  { key: "--color-accent-hover", label: "Accent Hover" },
  { key: "--color-success",      label: "Success" },
  { key: "--color-danger",       label: "Danger" },
];

const DEFAULT_VARS: Record<string, string> = {
  "--color-bg":           "#0f1115",
  "--color-bg-elevated":  "#161a21",
  "--color-surface":      "#1e2230",
  "--color-surface-hover":"#262c3e",
  "--color-border":       "#2a2f3d",
  "--color-text":         "#e8ecf4",
  "--color-text-muted":   "#8892a4",
  "--color-accent":       "#6aa3ff",
  "--color-accent-hover": "#82b4ff",
  "--color-success":      "#4caf82",
  "--color-danger":       "#e05260",
};

function parsePresets(json: string): CustomThemePreset[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr as CustomThemePreset[];
  } catch { /* ignore */ }
  return [];
}

export default function CustomThemeBuilder() {
  const { settings, update } = useSettings();
  const presets = parsePresets(settings.customThemes ?? "[]");

  const [editVars, setEditVars] = useState<Record<string, string>>({ ...DEFAULT_VARS });
  const [themeName, setThemeName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const handleVarChange = (key: string, val: string) => {
    setEditVars((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = useCallback(() => {
    const name = themeName.trim() || "My Theme";
    const id = editingId ?? `custom-${Date.now()}`;
    const next: CustomThemePreset = { id, name, vars: { ...editVars } };
    const updated = editingId
      ? presets.map((p) => (p.id === editingId ? next : p))
      : [...presets, next];
    void update({ customThemes: JSON.stringify(updated) }).then(() => {
      setSaveMsg("Saved!");
      setTimeout(() => setSaveMsg(null), 2200);
      if (!editingId) {
        setEditingId(id);
      }
    });
  }, [themeName, editingId, editVars, presets, update]);

  const handleApply = useCallback((preset: CustomThemePreset) => {
    void update({ activeCustomThemeId: preset.id });
  }, [update]);

  const handleClearCustom = useCallback(() => {
    void update({ activeCustomThemeId: "" });
  }, [update]);

  const handleEdit = (preset: CustomThemePreset) => {
    setEditingId(preset.id);
    setThemeName(preset.name);
    setEditVars({ ...DEFAULT_VARS, ...preset.vars });
    setSaveMsg(null);
  };

  const handleDelete = (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    void update({
      customThemes: JSON.stringify(updated),
      ...(settings.activeCustomThemeId === id ? { activeCustomThemeId: "" } : {}),
    });
    if (editingId === id) {
      setEditingId(null);
      setThemeName("");
      setEditVars({ ...DEFAULT_VARS });
    }
  };

  const handleNew = () => {
    setEditingId(null);
    setThemeName("");
    setEditVars({ ...DEFAULT_VARS });
    setSaveMsg(null);
  };

  const isAnyActive = !!settings.activeCustomThemeId;

  return (
    <div className="custom-theme-builder">

      {/* --- Saved presets list --- */}
      {presets.length > 0 && (
        <div className="ctb-saved-list">
          {presets.map((p) => {
            const isActive = settings.activeCustomThemeId === p.id;
            const isEditing = editingId === p.id;
            return (
              <div
                key={p.id}
                className={
                  "ctb-preset-card" +
                  (isActive ? " ctb-preset-card--active" : "") +
                  (isEditing ? " ctb-preset-card--editing" : "")
                }
              >
                <div className="ctb-preset-swatches">
                  {(["--color-bg", "--color-accent", "--color-surface", "--color-text"] as const).map((k) => (
                    <div
                      key={k}
                      className="ctb-preset-swatch"
                      style={{ background: (p.vars[k] ?? DEFAULT_VARS[k]) }}
                    />
                  ))}
                </div>
                <span className="ctb-preset-name">{p.name}</span>
                {isActive && <span className="ctb-active-badge">Active</span>}
                <div className="ctb-preset-actions">
                  <button
                    type="button"
                    className={`primary-button${isActive ? " primary-button--dim" : ""}`}
                    style={{ fontSize: 11, padding: "3px 10px" }}
                    onClick={() => (isActive ? handleClearCustom() : handleApply(p))}
                  >
                    {isActive ? "Deactivate" : "Apply"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button ghost-button--xs"
                    onClick={() => handleEdit(p)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ghost-button ghost-button--xs ctb-delete-btn"
                    onClick={() => handleDelete(p.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- Editor panel --- */}
      <div className="ctb-editor">
        <div className="ctb-editor-header">
          <h4 className="ctb-editor-title">
            {editingId ? "Edit theme" : "Create new theme"}
          </h4>
          {editingId && (
            <button type="button" className="ghost-button ghost-button--xs" onClick={handleNew}>
              + New
            </button>
          )}
        </div>

        <input
          type="text"
          className="ctb-name-input"
          value={themeName}
          placeholder="Theme name..."
          maxLength={40}
          onChange={(e) => setThemeName(e.target.value)}
        />

        <div className="ctb-vars-grid">
          {CSS_VARS.map(({ key, label }) => {
            const val = editVars[key] ?? DEFAULT_VARS[key];
            const isValidHex = /^#[0-9a-f]{3,8}$/i.test(val ?? "");
            return (
              <div key={key} className="ctb-var-row">
                <span className="ctb-var-label">{label}</span>
                <div className="ctb-var-inputs">
                  <div
                    className="ctb-color-wrap"
                    style={{ background: isValidHex ? val : "transparent" }}
                  >
                    <input
                      type="color"
                      className="ctb-color-picker"
                      value={isValidHex ? val : "#000000"}
                      onChange={(e) => handleVarChange(key, e.target.value)}
                    />
                  </div>
                  <input
                    type="text"
                    className="ctb-hex-input accent-custom__input"
                    value={val ?? ""}
                    maxLength={9}
                    spellCheck={false}
                    onChange={(e) => handleVarChange(key, e.target.value)}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (/^#[0-9a-f]{3,8}$/i.test(v)) handleVarChange(key, v);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Live preview */}
        <div
          className="ctb-preview"
          style={{ background: editVars["--color-bg"] ?? DEFAULT_VARS["--color-bg"] }}
          aria-label="Theme preview"
        >
          <div
            className="ctb-preview__sidebar"
            style={{
              background: editVars["--color-surface"] ?? DEFAULT_VARS["--color-surface"],
              borderRight: `1px solid ${editVars["--color-border"] ?? DEFAULT_VARS["--color-border"]}`,
            }}
          >
            {["Home", "Library", "Search"].map((item) => (
              <div
                key={item}
                className="ctb-preview__nav-item"
                style={{ color: editVars["--color-text"] ?? DEFAULT_VARS["--color-text"] }}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="ctb-preview__main">
            <div
              className="ctb-preview__row-title"
              style={{ color: editVars["--color-text"] ?? DEFAULT_VARS["--color-text"] }}
            >
              Trending Now
            </div>
            <div className="ctb-preview__cards">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="ctb-preview__card"
                  style={{
                    background: editVars["--color-surface"] ?? DEFAULT_VARS["--color-surface"],
                    border: `1px solid ${editVars["--color-border"] ?? DEFAULT_VARS["--color-border"]}`,
                  }}
                />
              ))}
            </div>
            <div className="ctb-preview__chips">
              <div
                className="ctb-preview__chip"
                style={{ background: editVars["--color-accent"] ?? DEFAULT_VARS["--color-accent"] }}
              />
              <div
                className="ctb-preview__chip ctb-preview__chip--success"
                style={{ background: editVars["--color-success"] ?? DEFAULT_VARS["--color-success"] }}
              />
              <div
                className="ctb-preview__chip ctb-preview__chip--danger"
                style={{ background: editVars["--color-danger"] ?? DEFAULT_VARS["--color-danger"] }}
              />
            </div>
          </div>
        </div>

        <div className="ctb-save-row">
          <button type="button" className="primary-button" onClick={handleSave}>
            {editingId ? "Update theme" : "Save theme"}
          </button>
          {isAnyActive && editingId === settings.activeCustomThemeId && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                handleSave();
                void update({ activeCustomThemeId: editingId ?? "" });
              }}
            >
              Update + Re-apply
            </button>
          )}
          {saveMsg && <span className="muted small" style={{ marginLeft: 8 }}>{saveMsg}</span>}
        </div>
      </div>
    </div>
  );
}
