import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GalaxyView } from './components/GalaxyView';
import { HUD } from './components/HUD';
import { StatsBar } from './components/StatsBar';
import { InspectorPanel } from './components/Inspector';
import { ConnectionForm } from './components/ConnectionForm';
import { useWebSocket } from './hooks/useWebSocket';
import { useCosmosStore } from './store';

export default function App(): React.ReactElement {
  useWebSocket();

  const { connectionStatus, showConnectionForm, setShowConnectionForm } = useCosmosStore();

  // Show connection form when not connected and form is not already visible
  useEffect(() => {
    if (!connectionStatus.connected && !showConnectionForm) {
      setShowConnectionForm(true);
    }
  }, [connectionStatus.connected, showConnectionForm, setShowConnectionForm]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-cosmos-bg">
      {/* Starfield background (CSS-only, subtle) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at 20% 50%, rgba(0,80,160,0.06) 0%, transparent 60%),
            radial-gradient(ellipse at 80% 20%, rgba(0,180,120,0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 60% 80%, rgba(120,0,200,0.04) 0%, transparent 50%)
          `,
        }}
      />

      {/* 3D Galaxy — fills entire screen */}
      <div className="absolute inset-0">
        <GalaxyView />
      </div>

      {/* HUD overlay — pointer-events auto only on interactive elements */}
      <div className="absolute inset-0 pointer-events-none flex flex-col">
        <div className="pointer-events-auto">
          <HUD />
        </div>

        {/* Main content area */}
        <div className="flex-1 relative">
          {/* Inspector panel (right side) */}
          <InspectorPanel />
        </div>

        {/* Stats bar */}
        <div className="pointer-events-auto">
          <StatsBar />
        </div>
      </div>

      {/* Connection form modal */}
      <AnimatePresence>
        {showConnectionForm && (
          <motion.div
            key="connection-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center z-50 pointer-events-auto"
            style={{ background: 'rgba(3,7,18,0.80)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => {
              // Close if clicking backdrop (not the form itself) and already connected
              if (e.target === e.currentTarget && connectionStatus.connected) {
                setShowConnectionForm(false);
              }
            }}
          >
            <ConnectionForm />
            {connectionStatus.connected && (
              <button
                className="absolute top-6 right-6 text-cosmos-muted hover:text-cosmos-text text-sm transition-colors"
                onClick={() => setShowConnectionForm(false)}
              >
                ✕
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
