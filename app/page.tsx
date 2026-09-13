"use client";

import AuthGate from '@/components/AuthGate';
import { ProjectProvider } from '@/components/ProjectContext';
import { ToastProvider } from '@/components/Toast';
import ProjectsHome from '@/components/projects/ProjectsHome';

// Accueil après connexion : la liste des projets. L'éditeur vit sur /editor/[id].
export default function HomePage() {
  return (
    <ToastProvider>
      <AuthGate>
        <ProjectProvider>
          <ProjectsHome />
        </ProjectProvider>
      </AuthGate>
    </ToastProvider>
  );
}
