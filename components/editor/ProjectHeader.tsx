"use client";

import { useState } from 'react';
import { useProject } from '@/components/ProjectContext';
import { Settings, Monitor } from 'lucide-react';
import ExportButton from './ExportButton';
import SaveIndicator from './SaveIndicator';
import SettingsModal, { FORMAT_PRESETS, isSamePreset } from './SettingsModal';
import UserMenu from './UserMenu';

export default function ProjectHeader() {
  const { projectSettings, setProjectSettings, currentProject } = useProject();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="min-h-14 bg-gray-950 border-b border-gray-800 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-2 select-none">

      <div className="flex flex-wrap items-center gap-2 text-gray-400 text-sm min-w-0">
        <Monitor size={16} className="shrink-0" />
        <span className="font-medium text-gray-200 truncate max-w-[16rem]" title={currentProject.name}>{currentProject.name}</span>
        <span className="text-gray-600">/</span>
        <span>Édition</span>
        <SaveIndicator />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Boutons de format */}
        <div role="group" aria-label="Format du projet" className="flex items-center gap-1 bg-gray-900 p-1 rounded-md border border-gray-800">
          {FORMAT_PRESETS.map((preset) => {
            const active = isSamePreset(projectSettings, preset);
            const Icon = preset.Icon;
            const name = preset.label === preset.ratio ? preset.ratio : `${preset.label} ${preset.ratio}`;
            return (
              <button
                key={preset.ratio}
                type="button"
                aria-pressed={active}
                aria-label={`Format ${name}`}
                onClick={() => setProjectSettings({ ...projectSettings, width: preset.width, height: preset.height })}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
                title={`${name} — ${preset.width}×${preset.height}`}
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
            <span className="text-xs font-bold text-blue-400 tabular-nums">
              {projectSettings.width} × {projectSettings.height}
            </span>
            <span className="text-[10px] text-gray-500">RES</span>
          </div>

          <div className="w-px h-6 bg-gray-800"></div>

          <div className="flex flex-col items-end leading-none">
            <span className="text-xs font-bold text-green-400 tabular-nums">
              {projectSettings.fps} FPS
            </span>
            <span className="text-[10px] text-gray-500">RATE</span>
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Paramètres du projet"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            title="Paramètres du projet"
            className="ml-2 p-1.5 hover:bg-gray-800 rounded-full text-gray-500 hover:text-gray-200 transition"
          >
            <Settings size={14} />
          </button>
        </div>

        <ExportButton />
        <UserMenu />
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
