import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import {
  createNodeObject,
  animateNodeObject,
  clusterHex,
  classifyTableRole,
  createQueryTrail,
  animateQueryTrail,
} from '@db-cosmos/engine-visual';
import type { QueryTrail } from '@db-cosmos/engine-visual';
import { useCosmosStore } from '../store';
import type { GraphNode } from '@db-cosmos/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GraphRef = any;

interface FGNode extends GraphNode {
  x?: number;
  y?: number;
  z?: number;
  __threeObj?: THREE.Group;
}

interface FGLink {
  id: string;
  source: string | FGNode;
  target: string | FGNode;
  sourceColumn: string;
  targetColumn: string;
}

interface GraphData {
  nodes: FGNode[];
  links: FGLink[];
}

// ── Camera distance → zoom level thresholds ──────────────────────────────────
const L1_DIST = 550;
const L3_DIST = 90;
const LABEL_SHOW_ALL = 450;
const LABEL_SHOW_HOT = 900;

// ── Trail spawn config ────────────────────────────────────────────────────────
const TRAIL_SPAWN_INTERVAL_MS = 2800;
const MAX_CONCURRENT_TRAILS   = 10;

// ── Interaction damping ───────────────────────────────────────────────────────
const PULSE_LERP_SPEED   = 0.06; // fraction per frame (~60fps → ~1s to fully transition)
const AUTOROTATE_RESUME_DELAY = 3500; // ms after last interaction to resume auto-rotate

// ── Procedural starfield ──────────────────────────────────────────────────────

function buildStarfield(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'starfield';

  // Layer 1: ~2000 tiny dim stars spread across a large sphere
  const count1 = 2000;
  const pos1 = new Float32Array(count1 * 3);
  for (let i = 0; i < count1; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 900 + Math.random() * 700;
    pos1[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos1[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos1[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo1 = new THREE.BufferGeometry();
  geo1.setAttribute('position', new THREE.BufferAttribute(pos1, 3));
  const mat1 = new THREE.PointsMaterial({
    color: 0xdde8ff,
    size: 0.85,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  group.add(new THREE.Points(geo1, mat1));

  // Layer 2: ~400 brighter, slightly larger stars
  const count2 = 400;
  const pos2 = new Float32Array(count2 * 3);
  for (let i = 0; i < count2; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 800 + Math.random() * 900;
    pos2[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos2[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos2[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo2 = new THREE.BufferGeometry();
  geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  const mat2 = new THREE.PointsMaterial({
    color: 0xfff0cc,
    size: 1.8,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    sizeAttenuation: true,
  });
  group.add(new THREE.Points(geo2, mat2));

  group.userData['mat1'] = mat1;
  group.userData['mat2'] = mat2;
  return group;
}

/** Single canvas-gradient nebula sprite for ambient depth */
function buildNebulaSprite(hsl: string, size: number, opacity: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width  = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, hsl);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({
    map:         tex,
    transparent: true,
    opacity,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GalaxyView(): React.ReactElement {
  const graphRef      = useRef<GraphRef>(null);
  const trailsRef     = useRef<QueryTrail[]>([]);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const starfieldRef  = useRef<THREE.Group | null>(null);
  const rafRef        = useRef<number>(0);
  const lastFpsTime   = useRef<number>(Date.now());
  const frameCount    = useRef<number>(0);

  // ── Stable refs (animation loop reads these without closure staleness) ────
  const selectedNodeIdRef  = useRef<string | null>(null);
  const clusterMapRef      = useRef<Record<string, number>>({});
  const directNeighborsRef = useRef<Set<string>>(new Set());
  const secondDegreeRef    = useRef<Set<string>>(new Set());
  const zoomLevelRef       = useRef<string>('L1');

  // ── Interaction freeze ───────────────────────────────────────────────────
  const isInteractingRef       = useRef(false);
  const interactionTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRotateResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Lerped 0→1 pulse amplitude multiplier (suppressed during drag) */
  const pulseMultRef           = useRef(1.0);

  // ── Trail rate-limiting ──────────────────────────────────────────────────
  const lastTrailSpawnRef = useRef<number>(0);

  // ── Subscriptions — only fields that affect JSX or neighbors ────────────
  // Activities intentionally NOT subscribed here; read via getState() in rAF.
  const graph        = useCosmosStore(s => s.graph);
  const selectedNodeId = useCosmosStore(s => s.selectedNodeId);
  const zoomLevel    = useCosmosStore(s => s.zoomLevel);
  const clusterMap   = useCosmosStore(s => s.clusterMap);
  const selectNode   = useCosmosStore(s => s.selectNode);
  const setFps       = useCosmosStore(s => s.setFps);
  const setZoomLevel = useCosmosStore(s => s.setZoomLevel);

  // Sync store values into refs (animation loop reads refs, never stale closures)
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { clusterMapRef.current = clusterMap; }, [clusterMap]);
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);

  // Recompute focus neighbor sets when selection changes
  useEffect(() => {
    if (!graph || !selectedNodeId) {
      directNeighborsRef.current = new Set();
      secondDegreeRef.current    = new Set();
      return;
    }
    const direct = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.source === selectedNodeId) direct.add(edge.target);
      else if (edge.target === selectedNodeId) direct.add(edge.source);
    }
    directNeighborsRef.current = direct;

    const second = new Set<string>();
    for (const edge of graph.edges) {
      const s = edge.source, t = edge.target;
      if (direct.has(s) && t !== selectedNodeId) second.add(t);
      if (direct.has(t) && s !== selectedNodeId) second.add(s);
    }
    secondDegreeRef.current = second;
  }, [selectedNodeId, graph]);

  // ── graphData — stable between schema reloads, never changes on metrics poll ─

  const graphData: GraphData = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    return {
      nodes: graph.nodes as FGNode[],
      links: graph.edges.map(e => ({
        id:           e.id,
        source:       e.source,
        target:       e.target,
        sourceColumn: e.sourceColumn,
        targetColumn: e.targetColumn,
      })),
    };
    // Only depends on structural identity — not metrics. graph.nodes reference
    // is stable between polls because updateMetrics no longer mutates graph.
  }, [graph]);

  // ── Node Three.js object ─────────────────────────────────────────────────

  const nodeThreeObject = useCallback((node: FGNode): THREE.Group => {
    const clusterId = clusterMapRef.current[node.id] ?? 0;
    const role = classifyTableRole(node.label, node.rowCount, node.metrics.relationDensity);
    return createNodeObject(node.metrics, node.rowCount, node.label, clusterId, role);
  }, []);

  // ── Link color — dynamic based on selection ──────────────────────────────

  const linkColor = useCallback((link: FGLink): string => {
    const selId = selectedNodeIdRef.current;
    if (!selId) return 'rgba(0,180,255,0.15)';

    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;

    if (srcId === selId || tgtId === selId) return 'rgba(0,212,255,0.75)';
    if (directNeighborsRef.current.has(srcId) && directNeighborsRef.current.has(tgtId)) {
      return 'rgba(0,180,255,0.38)';
    }
    return 'rgba(0,40,60,0.05)';
  }, []);

  // ── Node click → L2 camera tween ────────────────────────────────────────

  const handleNodeClick = useCallback((node: FGNode) => {
    const isSame = selectedNodeIdRef.current === node.id;
    selectNode(isSame ? null : node.id);

    if (!isSame && graphRef.current) {
      const dist = 130;
      const x = node.x ?? 0, y = node.y ?? 0, z = node.z ?? 0;
      graphRef.current.cameraPosition(
        { x: x + dist * 0.6, y: y + dist * 0.4, z: z + dist },
        { x, y, z },
        1200,
      );
      setZoomLevel('L2');
    } else if (isSame && graphRef.current) {
      graphRef.current.cameraPosition({ x: 0, y: 0, z: 600 }, { x: 0, y: 0, z: 0 }, 1200);
      setZoomLevel('L1');
    }
  }, [selectNode, setZoomLevel]);

  // ── Per-frame animation loop ─────────────────────────────────────────────

  useEffect(() => {
    let running = true;

    function animate() {
      if (!running) return;
      rafRef.current = requestAnimationFrame(animate);

      const now = Date.now();
      const t   = now * 0.001;

      // FPS
      frameCount.current++;
      if (now - lastFpsTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current  = 0;
        lastFpsTime.current = now;
      }

      if (!graphRef.current) return;

      // ── Lerp pulse multiplier toward target ──────────────────────────────
      const pulsTarget = isInteractingRef.current ? 0.04 : 1.0;
      pulseMultRef.current += (pulsTarget - pulseMultRef.current) * PULSE_LERP_SPEED;
      const pulseMult = pulseMultRef.current;

      try {
        const cam = graphRef.current.camera?.() as THREE.PerspectiveCamera | undefined;
        if (cam) {
          // Camera zoom → zoom level
          const dist = cam.position.length();
          const newLevel = dist > L1_DIST ? 'L1' : dist < L3_DIST ? 'L3' : 'L2';
          if (newLevel !== zoomLevelRef.current) {
            zoomLevelRef.current = newLevel;
            setZoomLevel(newLevel as 'L1' | 'L2' | 'L3');
          }

          const selId   = selectedNodeIdRef.current;
          const directN = directNeighborsRef.current;
          const secondN = secondDegreeRef.current;

          // Live metrics — read directly from store without React subscription
          const liveMetrics = useCosmosStore.getState().metrics;

          const nodes: FGNode[] = graphRef.current.graphData().nodes;
          for (const node of nodes) {
            if (!node.__threeObj) continue;
            const obj = node.__threeObj;

            // Sync live hotspot into userData so animateNodeObject sees it
            const nm = liveMetrics[node.id];
            if (nm) obj.userData['hotspot'] = nm.hotspotScore;

            // Focus opacity
            let focusOpacity = 1.0;
            if (selId && node.id !== selId) {
              if (directN.has(node.id))      focusOpacity = 0.85;
              else if (secondN.has(node.id)) focusOpacity = 0.30;
              else                           focusOpacity = 0.06;
            }

            // Label opacity
            let labelOpacity = 0;
            if (dist < LABEL_SHOW_ALL) {
              labelOpacity = selId
                ? (node.id === selId ? 1.0 : focusOpacity * 0.75)
                : 0.85;
            } else if (dist < LABEL_SHOW_HOT) {
              const hs = nm?.hotspotScore ?? (obj.userData['hotspot'] as number ?? 0);
              labelOpacity = hs > 0.25 ? 0.7 * focusOpacity : 0;
            }

            animateNodeObject(obj, t, focusOpacity, labelOpacity, pulseMult);
          }
        } else {
          // Camera not ready — animate without focus/zoom logic
          const nodes: FGNode[] = graphRef.current.graphData().nodes;
          for (const node of nodes) {
            if (node.__threeObj) animateNodeObject(node.__threeObj, t, 1, 0, pulseMult);
          }
        }
      } catch {
        // graph may not be ready yet
      }

      // ── Starfield subtle twinkle ─────────────────────────────────────────
      if (starfieldRef.current) {
        const m1 = starfieldRef.current.userData['mat1'] as THREE.PointsMaterial | undefined;
        const m2 = starfieldRef.current.userData['mat2'] as THREE.PointsMaterial | undefined;
        if (m1) m1.opacity = 0.50 + Math.sin(t * 0.35) * 0.06;
        if (m2) m2.opacity = 0.33 + Math.sin(t * 0.28 + 1.4) * 0.06;
      }

      // ── Query trails — animate + reap expired ───────────────────────────
      if (sceneGroupRef.current) {
        const group = sceneGroupRef.current;
        trailsRef.current = trailsRef.current.filter(trail => {
          const alive = animateQueryTrail(trail);
          if (!alive) {
            group.remove(trail.line);
            group.remove(trail.particles);
            trail.line.geometry.dispose();
            trail.particles.geometry.dispose();
          }
          return alive;
        });
      }

      // ── Trail spawning — rate-limited, reads store without subscribing ───
      if (
        sceneGroupRef.current &&
        !isInteractingRef.current &&
        trailsRef.current.length < MAX_CONCURRENT_TRAILS &&
        now - lastTrailSpawnRef.current > TRAIL_SPAWN_INTERVAL_MS
      ) {
        const activities = useCosmosStore.getState().activities;
        if (activities.length > 0 && graphRef.current) {
          // Pick one activity per spawn tick; bias toward multi-table joins
          const candidate = activities.find(a => a.sourceTables.length >= 2) ?? activities[0];
          if (candidate && candidate.sourceTables.length >= 2) {
            try {
              const allNodes: FGNode[] = graphRef.current.graphData().nodes;
              const findN = (name: string): FGNode | undefined =>
                allNodes.find(n => n.label === name || n.id.endsWith(`.${name}`));

              const src = findN(candidate.sourceTables[0]);
              const dst = findN(candidate.sourceTables[1]);
              if (src && dst && src.x != null && dst.x != null) {
                const srcPos = new THREE.Vector3(src.x, src.y ?? 0, src.z ?? 0);
                const dstPos = new THREE.Vector3(dst.x, dst.y ?? 0, dst.z ?? 0);
                const cid    = clusterMapRef.current[src.id] ?? 0;
                const color  = new THREE.Color(clusterHex(cid, src.metrics?.hotspotScore ?? 0.3));
                const trail  = createQueryTrail(`rAF-${now}`, srcPos, dstPos, color);
                sceneGroupRef.current.add(trail.line);
                sceneGroupRef.current.add(trail.particles);
                trailsRef.current.push(trail);
                lastTrailSpawnRef.current = now;
              }
            } catch {
              // node positions not yet settled
            }
          }
        }
      }
    }

    animate();
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [setFps, setZoomLevel]);

  // ── Scene initialisation (after graph mounts) ────────────────────────────

  useEffect(() => {
    if (!graphRef.current || !graph) return;
    const timer = setTimeout(() => {
      if (!graphRef.current) return;
      try {
        const scene: THREE.Scene = graphRef.current.scene();

        // Trail group
        if (scene && !sceneGroupRef.current) {
          const group = new THREE.Group();
          group.name = 'trail-group';
          scene.add(group);
          sceneGroupRef.current = group;
        }

        // Starfield (only once)
        if (scene && !starfieldRef.current) {
          const sf = buildStarfield();
          scene.add(sf);
          starfieldRef.current = sf;

          // Nebula sprites for ambient depth
          const nebulae: Array<[string, number, number, [number,number,number]]> = [
            ['rgba(20,40,100,0.9)',  900, 0.055, [ 500, 200, -800]],
            ['rgba(60,10,80,0.9)',   700, 0.045, [-600, -100, 600]],
            ['rgba(0,60,80,0.9)',    600, 0.040, [ 200, -400, 700]],
          ];
          for (const [color, size, opacity, pos] of nebulae) {
            const sprite = buildNebulaSprite(color, size, opacity);
            sprite.position.set(...pos);
            scene.add(sprite);
          }
        }

        // Controls
        const controls = graphRef.current.controls();
        if (controls) {
          controls.autoRotate      = true;
          controls.autoRotateSpeed = 0.15;
          controls.enableDamping   = true;
          controls.dampingFactor   = 0.12;
          controls.zoomSpeed       = 0.7;
          controls.rotateSpeed     = 0.6;

          const onStart = () => {
            isInteractingRef.current = true;
            controls.autoRotate = false;
            if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
            if (autoRotateResumeTimerRef.current) clearTimeout(autoRotateResumeTimerRef.current);
          };
          const onEnd = () => {
            isInteractingRef.current = false;
            if (autoRotateResumeTimerRef.current) clearTimeout(autoRotateResumeTimerRef.current);
            autoRotateResumeTimerRef.current = setTimeout(() => {
              if (graphRef.current) {
                const c = graphRef.current.controls();
                if (c) c.autoRotate = true;
              }
            }, AUTOROTATE_RESUME_DELAY);
          };

          controls.addEventListener('start', onStart);
          controls.addEventListener('end', onEnd);
        }
      } catch {
        // graph may not be fully rendered yet
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph?.nodes.length]);

  // Cleanup starfield on unmount
  useEffect(() => {
    return () => {
      if (autoRotateResumeTimerRef.current) clearTimeout(autoRotateResumeTimerRef.current);
      if (interactionTimerRef.current) clearTimeout(interactionTimerRef.current);
    };
  }, []);

  // ── Empty state ──────────────────────────────────────────────────────────

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-cosmos-muted text-sm font-mono animate-pulse">
          awaiting connection…
        </div>
      </div>
    );
  }

  // ── Zoom level badge ─────────────────────────────────────────────────────

  const ZOOM_LABELS: Record<string, string> = { L1: 'GALAXY', L2: 'ORBIT', L3: 'INSPECTION' };

  return (
    <div className="w-full h-full" style={{ background: '#030712' }}>
      <div
        className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20
          font-mono text-[10px] tracking-widest px-3 py-1 rounded-full
          border border-cosmos-border/40 text-cosmos-muted
          pointer-events-none select-none"
        style={{ background: 'rgba(3,7,18,0.65)', backdropFilter: 'blur(4px)' }}
      >
        {ZOOM_LABELS[zoomLevel] ?? zoomLevel}
        {selectedNodeId && zoomLevel !== 'L1' && (
          <span className="text-cosmos-accent ml-2">
            · {graph.nodes.find(n => n.id === selectedNodeId)?.label ?? ''}
          </span>
        )}
      </div>

      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        nodeId="id"
        nodeLabel={() => ''}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={0.5}
        linkOpacity={0.28}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={0.55}
        linkDirectionalParticleColor={(link: FGLink) => {
          const srcId = typeof link.source === 'object' ? link.source.id : link.source;
          const cid = clusterMapRef.current[srcId] ?? 0;
          return clusterHex(cid, 0.3);
        }}
        linkDirectionalParticleSpeed={0.003}
        backgroundColor="#030712"
        showNavInfo={false}
        onNodeClick={handleNodeClick}
        cooldownTicks={150}
        d3AlphaDecay={0.018}
        d3VelocityDecay={0.45}
        warmupTicks={40}
      />
    </div>
  );
}
