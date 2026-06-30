import React from "react";

export default function MultiSelect({ id, label, options, value = [], onChange, placeholder = "Select…" }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const ref = React.useRef(null);

  React.useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };

  const remove = (opt) => onChange(value.filter((v) => v !== opt));
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      {label && <label className="font-label block mb-2">{label}</label>}
      <div
        data-testid={`multiselect-${id}`}
        className="evcl-input cursor-text flex flex-wrap items-center gap-1 min-h-[42px]"
        onClick={() => setOpen(true)}
      >
        {value.length === 0 && <span className="text-[#999]">{placeholder}</span>}
        {value.map((v) => (
          <span key={v} className="chip">
            {v}
            <button
              type="button"
              data-testid={`chip-remove-${id}-${v}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(v);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-[#DCDCCF] max-h-72 overflow-auto">
          <input
            autoFocus
            data-testid={`multiselect-search-${id}`}
            className="evcl-input border-b border-[#DCDCCF]"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-xs font-mono-tight text-[#666]">No matches</div>
          )}
          {filtered.map((opt) => {
            const checked = value.includes(opt);
            return (
              <div
                key={opt}
                data-testid={`multiselect-option-${id}-${opt}`}
                onClick={() => toggle(opt)}
                className={`px-3 py-2 text-sm font-mono-tight cursor-pointer flex items-center justify-between ${
                  checked ? "bg-black text-white" : "hover:bg-[#F0F0EE]"
                }`}
              >
                <span>{opt}</span>
                {checked && <span>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
