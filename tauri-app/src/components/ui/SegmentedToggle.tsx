import React from "react";

/// Compact icon-toggle row — mirrors Google Maps' segmented controls.
export const SegmentedToggle: React.FC<{
  options: Array<{ id: string; label: string; icon: React.ComponentType<{ size?: number }> }>;
  value: string;
  onChange: (id: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="mode-toggle" role="group">
    {options.map((opt) => {
      const Icon = opt.icon;
      return (
        <button
          key={opt.id}
          type="button"
          className={`mode-toggle-btn ${value === opt.id ? "active" : ""}`}
          aria-pressed={value === opt.id}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => onChange(opt.id)}
        >
          <Icon size={16} />
          <span>{opt.label}</span>
        </button>
      );
    })}
  </div>
);
