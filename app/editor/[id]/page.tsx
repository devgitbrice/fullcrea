"use client";

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import AuthGate from '@/components/AuthGate';
import { ProjectProvider } from '@/components/ProjectContext';
import { ToastProvider } from '@/components/Toast';
import EditorGate from '@/components/editor/EditorGate';
import EditorLayout from '@/components/editor/EditorLayout';

function Spinner() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-gray-400">
      <Loader2 className="animate-spin" size={24} />
    </div>
  );
}

// Éditeur d'un projet : /editor/<id>, ou /editor/<id>?t=<jeton> pour rejoindre un projet en co-édition
function EditorRoute() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('t') ?? undefined;

  return (
    <ToastProvider>
      <AuthGate>
        <ProjectProvider initialProjectId={id} editToken={shareToken}>
          <EditorGate shareToken={shareToken}>
            <EditorLayout />
          </EditorGate>
        </ProjectProvider>
      </AuthGate>
    </ToastProvider>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <EditorRoute />
    </Suspense>
  );
}
