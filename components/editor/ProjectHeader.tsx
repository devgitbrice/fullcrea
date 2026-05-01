"use client";

import { useProject } from '@/components/ProjectContext';
import { Settings, Monitor, RectangleHorizontal, RectangleVertical, Square } from 'lucide-react';
import ExportButton from './ExportButton';

interface FormatPreset {
  label: string;
  ratio: string;
  width: number;
  height: number;
  Icon: typeof RectangleHorizontal;
}

const FORMAT_PRESETS: FormatPreset[] = [
  { label: 'Paysage', ratio: '16:9',  width: 1920, height: 1080, Icon: RectangleHorizontal },
  { label: 'Portrait', ratio: '9:16', width: 1080, height: 1920, Icon: RectangleVertical },
  { label: 'Carré',   ratio: '1:1',   width: 1080, height: 1080, Icon: Square },
  { label: '3:4',      ratio: '3:4',  width: 1080, height: 1440, Icon: RectangleVertical },
];

function isSamePreset(a: { width: number; height: number }, p: FormatPreset) {
  return a.width === p.width && a.height === p.height;
}

export default function ProjectHeader() {
  const { projectSettings, setProjectSettings, currentProject } = useProject();

  return (
    <div className="h-14 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-6 select-none">

      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Monitor size={16} />
        <span className="font-medium text-gray-200">{currentProject.name}</span>
        <span className="text-gray-600">/</span>
        <span>Édition</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Boutons de format */}
        <div className="flex items-center gap-1 bg-gray-900 p-1 rounded-md border border-gray-800">
          {FORMAT_PRESETS.map((preset) => {
            const active = isSamePreset(projectSettings, preset);
            const Icon = preset.Icon;
            return (
              <button
                key={preset.ratio}
                onClick={() => setProjectSettings({ ...projectSettings, width: preset.width, height: preset.height })}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
                title={`${preset.label} ${preset.ratio} — ${preset.width}×${preset.height}`}
              >
                <Icon size={12} />
                <span>{preset.ratio}</span>
              </button>
            );
          })}
        </div>

        {/* Infos résolution / FPS */}
        <div className="flex items-center gap-4 bg-gray-900 px-3 py-1.5 rounded-md border border-gray-800">
          <div className="flex flex-col items-end leading-none">
            <span className="text-xs font-bold text-blue-400">
              {projectSettings.width} × {projectSettings.height}
            </span>
            <span className="text-[10px] text-gray-500">RES</span>
          </div>

          <div className="w-px h-6 bg-gray-800"></div>

          <div className="flex flex-col items-end leading-none">
            <span className="text-xs font-bold text-green-400">
              {projectSettings.fps} FPS
            </span>
            <span className="text-[10px] text-gray-500">RATE</span>
          </div>

          <button className="ml-2 p-1.5 hover:bg-gray-800 rounded-full text-gray-500 transition">
            <Settings size={14} />
          </button>
        </div>

        <ExportButton />
      </div>
    </div>
  );
}
