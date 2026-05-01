"use client";

import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown } from 'lucide-react';

const RESOLUTIONS = [
  { id: 'hd',   label: 'Full HD — 1920 × 1080', width: 1920, height: 1080 },
  { id: 'qhd',  label: '2K QHD — 2560 × 1440',  width: 2560, height: 1440 },
  { id: 'uhd',  label: '4K UHD — 3840 × 2160',  width: 3840, height: 2160 },
] as const;

type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

export default function ExportButton() {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<ResolutionId>('hd');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleExport = () => {
    const r = RESOLUTIONS.find((x) => x.id === resolution)!;
    alert(
      `Export ${r.width}×${r.height} — fonctionnalité en cours d'intégration.\n` +
      `Le rendu vidéo final sera disponible dans une prochaine mise à jour.`
    );
    setOpen(false);
  };

  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-700 text-white px-3 py-1.5 rounded text-xs font-semibold transition shadow-md shadow-orange-900/30"
      >
        <Download size={13} />
        Exporter
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-gray-950 border border-gray-800 rounded-md shadow-2xl z-50 p-3 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Résolution
            </label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as ResolutionId)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-orange-600"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleExport}
            className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white py-2 rounded text-xs font-semibold transition"
          >
            <Download size={13} /> Lancer l'export
          </button>
        </div>
      )}
    </div>
  );
}
