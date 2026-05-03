import * as THREE from 'three';
import type { TableMetrics } from '@db-cosmos/shared';

// ── Colour helpers ────────────────────────────────────────────────────────────

const COLD_COLOR = new THREE.Color('#0a1628');
const WARM_COLOR = new THREE.Color('#00d4ff');
const HOT_COLOR  = new THREE.Color('#ff6600');
const FIRE_COLOR = new THREE.Color('#ff1100');

/** Interpolate hotspot colour: 0 → deep blue, 0.3 → cyan, 0.7 → orange, 1 → red */
export function hotspotColor(score: number): THREE.Color {
  const c = new THREE.Color();
  if (score < 0.3) {
    return c.lerpColors(COLD_COLOR, WARM_COLOR, score / 0.3);
  } else if (score < 0.7) {
    return c.lerpColors(WARM_COLOR, HOT_COLOR, (score - 0.3) / 0.4);
  } else {
    return c.lerpColors(HOT_COLOR, FIRE_COLOR, (score - 0.7) / 0.3);
  }
}

export function hotspotHex(score: number): string {
  return `#${hotspotColor(score).getHexString()}`;
}

/**
 * Deterministic hue for a cluster using golden-angle distribution.
 * Produces visually distinct, well-separated hues across any number of clusters.
 */
export function clusterHue(clusterId: number): number {
  return (clusterId * 137.508) % 360;
}

/** Fine hue offsets per role to distinguish planets within the same cluster */
const ROLE_HUE_SHIFT: Record<string, number> = {
  reference:  20,   // cooler / bluer
  bridge:    -25,   // purple-ish
  fact:       10,   // warmer
  dimension:  -8,   // slight magenta
  unknown:     0,
};

/**
 * Base color for a cluster/role combination at a given hotspot intensity.
 * Cluster defines HUE; role applies a ±offset; hotspot modulates saturation+lightness.
 */
export function clusterColor(
  clusterId: number,
  hotspotScore: number,
  role: TableRole = 'unknown',
): THREE.Color {
  const shift = ROLE_HUE_SHIFT[role] ?? 0;
  const rawHue = clusterHue(clusterId) + shift;
  const hue = ((rawHue % 360) + 360) % 360 / 360;
  const sat = 0.55 + hotspotScore * 0.35;
  const lit = 0.28 + hotspotScore * 0.18;
  return new THREE.Color().setHSL(hue, sat, lit);
}

export function clusterHex(clusterId: number, hotspotScore: number, role: TableRole = 'unknown'): string {
  return `#${clusterColor(clusterId, hotspotScore, role).getHexString()}`;
}

// ── Table role classification ─────────────────────────────────────────────────

export type TableRole = 'reference' | 'bridge' | 'fact' | 'dimension' | 'unknown';

// Patterns evaluated against lowercased table name
const REFERENCE_RE = [
  /^(country|countri|cit(?:y|ies)|language|currency|timezone|locale|nation|region|continent)s?$/,
  /^(status|state|type|class|category|categor(?:y|ies)|tag|badge|format|unit|code|flag|rating|genre)s?$/,
  /_(type|status|class|code|category|language|currency|flag|rating|tier)s?$/,
  /^(config|configuration|setting|constant|lookup|enum|parameter)s?$/,
];

const BRIDGE_RE = [
  // Exactly two nouns joined by underscore — classic junction pattern
  /^[a-z][a-z0-9]+_[a-z][a-z0-9]+$/,
  // Explicit bridge suffixes
  /_(actor|film|movie|book|product|user|member|role|group|order|item|tag|category|topic|skill)s?$/,
  /^(user|film|product|order|question|member|post)_(tag|actor|category|badge|role|group|skill)s?$/,
];

const FACT_RE = [
  /^(payment|rental|invoice|bill|transaction|purchase|sale|order|booking|reservation)s?$/,
  /^(event|log|audit|history|activity|access|session|visit|click|view|impression)s?$/,
  /_(log|event|audit|history|transaction|payment|rental|booking|entry|record)s?$/,
];

const DIMENSION_RE = [
  /^(customer|client|member|subscriber|tenant|account)s?$/,
  /^(staff|employee|worker|agent|operator|manager|director)s?$/,
  /^(actor|author|person|people|contact|individual|user)s?$/,
  /^(address|location|place|site|facility|store|warehouse|branch|office|outlet)s?$/,
  /^(inventory|product|item|asset|resource|sku|article)s?$/,
  /^(film|movie|book|album|show|series|episode|content|media)s?$/,
];

/**
 * Classify a table into a visual role using name heuristics + data signals.
 * Pure function — no network calls.
 */
export function classifyTableRole(
  tableName: string,
  rowCount: number,
  relationDensity: number,
): TableRole {
  const name = tableName.toLowerCase().replace(/^[a-z]+\./, ''); // strip schema prefix

  // Bridge first: high fan-in/fan-out OR junction-like name with ≥2 FK edges
  if (BRIDGE_RE.some(r => r.test(name)) && relationDensity >= 2) return 'bridge';
  if (relationDensity >= 5 && rowCount < 200_000) return 'bridge';

  // Reference: small lookup table
  if (REFERENCE_RE.some(r => r.test(name))) return 'reference';
  if (rowCount > 0 && rowCount < 200 && relationDensity <= 2) return 'reference';

  // Fact: transactional / event-sourced
  if (FACT_RE.some(r => r.test(name))) return 'fact';
  if (rowCount > 10_000) return 'fact';

  // Dimension: entity / party
  if (DIMENSION_RE.some(r => r.test(name))) return 'dimension';

  return 'unknown';
}

// ── Node geometry ─────────────────────────────────────────────────────────────

/** Base sphere radius from row count (log scale, clamped) */
export function nodeRadius(rowCount: number): number {
  return Math.max(3, Math.min(18, Math.log10(rowCount + 2) * 4));
}

function formatRowCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Build a DPR-aware, high-res canvas billboard label.
 *
 * The canvas backing store is scaled by devicePixelRatio (clamped 1–3) so that
 * labels stay crisp at any zoom level.  Logical drawing coordinates are kept at
 * the base W×H size and scaled via ctx.scale(dpr, dpr).
 *
 * Texture filters are set to LinearFilter + no mipmaps — correct for sprites
 * where the GPU zooms into a single texture without LOD levels.
 */
function createLabelSprite(label: string, rowCount: number, radius: number, role: TableRole): THREE.Sprite {
  // Logical dimensions (design space)
  const LW = 512, LH = 96;

  // Physical backing-store size scaled by DPR for crisp rendering
  const dpr = Math.min(Math.max(
    typeof devicePixelRatio !== 'undefined' ? Math.ceil(devicePixelRatio) : 2,
    1,
  ), 3);
  const PW = LW * dpr, PH = LH * dpr;

  const canvas = document.createElement('canvas');
  canvas.width  = PW;
  canvas.height = PH;
  const ctx = canvas.getContext('2d')!;

  // Scale context so all draw calls use logical px
  ctx.scale(dpr, dpr);

  // Transparent base
  ctx.clearRect(0, 0, LW, LH);

  // Pill background with subtle role tint
  const roleBgTint: Record<TableRole, string> = {
    reference: 'rgba(10,20,50,0.78)',
    bridge:    'rgba(20,5,40,0.78)',
    fact:      'rgba(30,10,5,0.78)',
    dimension: 'rgba(5,20,30,0.78)',
    unknown:   'rgba(3,7,18,0.76)',
  };
  ctx.fillStyle = roleBgTint[role];
  ctx.beginPath();
  ctx.roundRect(2, 2, LW - 4, LH - 4, 10);
  ctx.fill();

  // Border — colour matches role accent
  const roleBorder: Record<TableRole, string> = {
    reference: 'rgba(120,160,255,0.45)',
    bridge:    'rgba(180,100,255,0.45)',
    fact:      'rgba(255,140,60,0.45)',
    dimension: 'rgba(0,212,255,0.45)',
    unknown:   'rgba(0,212,255,0.30)',
  };
  ctx.strokeStyle = roleBorder[role];
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(2, 2, LW - 4, LH - 4, 10);
  ctx.stroke();

  // Role icon glyph (left side)
  const roleIcon: Record<TableRole, string> = {
    reference: '◆', bridge: '⬡', fact: '⬟', dimension: '●', unknown: '○',
  };
  ctx.font = '22px sans-serif';
  ctx.fillStyle = roleBorder[role];
  ctx.textAlign = 'left';
  ctx.fillText(roleIcon[role], 10, 44);

  // Table name — large bold mono
  ctx.font = 'bold 28px "Courier New", Courier, monospace';
  ctx.fillStyle = 'rgba(235,245,255,0.96)';
  ctx.textAlign = 'left';
  // Clip long names
  const maxNameW = LW - 48;
  ctx.save();
  ctx.rect(42, 0, maxNameW, 56);
  ctx.clip();
  ctx.fillText(label, 42, 40);
  ctx.restore();

  // Row count — second line, smaller, accent colour
  ctx.font = '20px "Courier New", Courier, monospace';
  ctx.fillStyle = roleBorder[role].replace('0.45', '0.85').replace('0.30', '0.75');
  ctx.fillText(`rows: ${formatRowCount(rowCount)}`, 42, 72);

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter       = THREE.LinearFilter;
  texture.magFilter       = THREE.LinearFilter;
  texture.needsUpdate     = true;

  const mat = new THREE.SpriteMaterial({
    map:             texture,
    transparent:     true,
    opacity:         0.9,
    depthTest:       false,
    sizeAttenuation: true,
  });

  const sprite = new THREE.Sprite(mat);
  // World-scale based on logical W/H to stay consistent across DPR values
  const sw = Math.max(26, radius * 3.2);
  sprite.scale.set(sw, sw * (LH / LW), 1);
  sprite.position.set(0, radius + sw * 0.36, 0);
  sprite.userData['mat'] = mat;
  sprite.renderOrder = 999;

  return sprite;
}

/**
 * Create a Three.js Group representing a database table node.
 *
 * Visual language by role:
 *   reference  — small, polished/crystalline sphere; thin single ring
 *   bridge     — medium, matte flattened; double ring at 90° offset; purple tint
 *   fact       — large, rocky; thick ring; 3–4 orbiting satellite beads
 *   dimension  — normal, polished; medium ring; 1–2 satellite beads
 *   unknown    — default appearance
 *
 * userData stores all materials + mesh refs for per-frame animation.
 */
export function createNodeObject(
  metrics: TableMetrics,
  rowCount: number,
  label?: string,
  clusterId?: number,
  role: TableRole = 'unknown',
): THREE.Group {
  const { hotspotScore, relationDensity } = metrics;
  const cid    = clusterId ?? 0;
  const color  = clusterColor(cid, hotspotScore, role);
  const radius = nodeRadius(rowCount) * ROLE_RADIUS_SCALE[role];

  const group = new THREE.Group();

  // ── Core sphere ─────────────────────────────────────────────────────────────

  const segments  = ROLE_SEGMENTS[role];
  const shininess = ROLE_SHININESS[role];

  const coreGeo = new THREE.SphereGeometry(radius, segments, segments);
  const coreMat = new THREE.MeshPhongMaterial({
    color,
    emissive:          color,
    emissiveIntensity: 0.25 + hotspotScore * 0.6,
    transparent:       true,
    opacity:           0.92,
    shininess,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);

  // Bridge tables: slightly flattened disc-like
  if (role === 'bridge') core.scale.set(1, 0.82, 1);

  group.add(core);

  // ── Outer glow halo ─────────────────────────────────────────────────────────

  if (hotspotScore > 0.15) {
    const haloGeo = new THREE.SphereGeometry(radius * 1.65, 14, 14);
    const haloMat = new THREE.MeshPhongMaterial({
      color,
      emissive:          color,
      emissiveIntensity: hotspotScore * 1.2,
      transparent:       true,
      opacity:           0.12 * hotspotScore,
      side:              THREE.BackSide,
      depthWrite:        false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    group.add(halo);
    group.userData['haloMat'] = haloMat;
  }

  // ── Orbit ring(s) ────────────────────────────────────────────────────────────

  if (relationDensity > 0) {
    const ringRadius  = radius * 1.55;
    // Bridge gets a thicker tube; reference gets a thin hairline
    const tubeBase    = role === 'bridge'    ? Math.max(0.4, Math.min(1.0, relationDensity * 0.1))
                      : role === 'reference' ? Math.max(0.15, Math.min(0.3, relationDensity * 0.04))
                      :                        Math.max(0.25, Math.min(0.8, relationDensity * 0.08));
    const ringOpacity = Math.min(0.75, 0.18 + relationDensity * 0.06);

    const ringGeo = new THREE.TorusGeometry(ringRadius, tubeBase, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity:     ringOpacity,
      depthWrite:  false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 3.5 + (cid % 3) * 0.3;
    ring.rotation.y = (cid * 0.9) % (Math.PI * 2);
    group.add(ring);
    group.userData['ring']           = ring;
    group.userData['ringMat']        = ringMat;
    group.userData['ringBaseOpacity'] = ringOpacity; // fix: store for animation use

    // Bridge: second ring at 90° offset (cross-ring effect)
    if (role === 'bridge') {
      const ring2Geo = new THREE.TorusGeometry(ringRadius * 0.88, tubeBase * 0.65, 8, 48);
      const ring2Mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity:     ringOpacity * 0.65,
        depthWrite:  false,
      });
      const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
      ring2.rotation.x = ring.rotation.x + Math.PI / 2;
      ring2.rotation.y = ring.rotation.y + 0.4;
      group.add(ring2);
      group.userData['ring2']           = ring2;
      group.userData['ring2Mat']        = ring2Mat;
      group.userData['ring2BaseOpacity'] = ringOpacity * 0.65;
    }
  }

  // ── Satellite beads (fact + dimension) ──────────────────────────────────────

  const beadCount = role === 'fact' ? 4 : role === 'dimension' ? 2 : 0;
  if (beadCount > 0) {
    const beadR     = radius * 0.17;
    const beadOrbit = radius * 2.2;
    const beads: THREE.Mesh[] = [];

    for (let i = 0; i < beadCount; i++) {
      const angle  = (i / beadCount) * Math.PI * 2;
      const beadGeo = new THREE.SphereGeometry(beadR, 6, 6);
      const beadMat = new THREE.MeshPhongMaterial({
        color,
        emissive:          color,
        emissiveIntensity: 0.4,
        transparent:       true,
        opacity:           0.75,
        shininess:         60,
      });
      const bead = new THREE.Mesh(beadGeo, beadMat);
      bead.position.set(Math.cos(angle) * beadOrbit, 0, Math.sin(angle) * beadOrbit);
      group.add(bead);
      beads.push(bead);
    }
    group.userData['beads']           = beads;
    group.userData['beadOrbitRadius'] = beadOrbit;
    group.userData['beadPhaseOffset'] = Math.random() * Math.PI * 2;
  }

  // ── Billboard label sprite ───────────────────────────────────────────────────

  if (label) {
    const sprite = createLabelSprite(label, rowCount, radius, role);
    group.add(sprite);
    group.userData['labelSprite'] = sprite;
  }

  group.userData['coreMat']   = coreMat;
  group.userData['hotspot']   = hotspotScore;
  group.userData['phase']     = Math.random() * Math.PI * 2;
  group.userData['clusterId'] = cid;
  group.userData['radius']    = radius;
  group.userData['role']      = role;

  return group;
}

// Role-specific geometry constants
const ROLE_RADIUS_SCALE: Record<TableRole, number> = {
  reference: 0.82,
  bridge:    0.95,
  fact:      1.18,
  dimension: 1.05,
  unknown:   1.00,
};
const ROLE_SEGMENTS: Record<TableRole, number> = {
  reference: 12,
  bridge:    16,
  fact:      22,
  dimension: 20,
  unknown:   18,
};
const ROLE_SHININESS: Record<TableRole, number> = {
  reference: 120,  // crystalline / moon-like
  bridge:    30,   // matte
  fact:      25,   // rough rocky
  dimension: 75,   // polished
  unknown:   60,
};

/**
 * Update a node Group's materials each frame.
 *
 * @param group           The node's Three.js Group (from createNodeObject)
 * @param t               Seconds (Date.now() * 0.001)
 * @param focusOpacity    0–1; focus-mode dimming
 * @param labelOpacity    0–1; camera-distance driven label fade
 * @param pulseMultiplier 0–1; interaction damping — set to near-0 while camera is being dragged,
 *                        lerped back to 1.0 after interaction ends. Prevents visual jitter
 *                        / scatto during rotation.
 */
export function animateNodeObject(
  group: THREE.Group,
  t: number,
  focusOpacity = 1.0,
  labelOpacity = 0.9,
  pulseMultiplier = 1.0,
): void {
  const hotspot: number  = group.userData['hotspot'] ?? 0;
  const phase:   number  = group.userData['phase']   ?? 0;
  const coreMat: THREE.MeshPhongMaterial | undefined = group.userData['coreMat'];
  const haloMat: THREE.MeshPhongMaterial | undefined = group.userData['haloMat'];
  const ring:    THREE.Mesh | undefined = group.userData['ring'];
  const ringMat: THREE.MeshBasicMaterial | undefined = group.userData['ringMat'];
  const ring2:   THREE.Mesh | undefined = group.userData['ring2'];
  const ring2Mat:THREE.MeshBasicMaterial | undefined = group.userData['ring2Mat'];

  if (!coreMat) return;

  // pulseMultiplier dampens all oscillating effects during camera interaction
  const pulse = Math.sin(t * 2.5 + phase) * 0.12 * hotspot * pulseMultiplier;
  coreMat.emissiveIntensity = 0.25 + hotspot * 0.6 + pulse;
  coreMat.opacity = 0.92 * focusOpacity;

  if (haloMat) {
    haloMat.opacity = Math.max(0, (0.12 + pulse * 0.5) * hotspot * focusOpacity);
  }

  if (ring && ringMat) {
    ring.rotation.z += 0.003 * (1 + hotspot * 2.5);
    ringMat.opacity = Math.max(0, (group.userData['ringBaseOpacity'] as number) * focusOpacity);
  }
  if (ring2 && ring2Mat) {
    ring2.rotation.z -= 0.002 * (1 + hotspot * 2.0); // counter-rotate for effect
    ring2Mat.opacity = Math.max(0, (group.userData['ring2BaseOpacity'] as number) * focusOpacity);
  }

  // Orbiting satellite beads — slow orbit speed during interaction
  const beads: THREE.Mesh[] = group.userData['beads'] ?? [];
  const beadOrbit: number   = group.userData['beadOrbitRadius'] ?? 0;
  const beadPhase: number   = group.userData['beadPhaseOffset'] ?? 0;
  for (let i = 0; i < beads.length; i++) {
    const angle = t * 0.28 * (0.1 + pulseMultiplier * 0.9) + beadPhase + (i / beads.length) * Math.PI * 2;
    beads[i].position.set(
      Math.cos(angle) * beadOrbit,
      Math.sin(angle * 0.35) * beadOrbit * 0.12,
      Math.sin(angle) * beadOrbit,
    );
    const bm = beads[i].material as THREE.MeshPhongMaterial;
    bm.opacity = Math.max(0, 0.75 * focusOpacity);
  }

  // Label visibility
  const labelSprite: THREE.Sprite | undefined = group.userData['labelSprite'];
  if (labelSprite) {
    const lMat = labelSprite.material as THREE.SpriteMaterial;
    lMat.opacity = Math.max(0, Math.min(1, labelOpacity));
  }

  // Scale oscillation — suppressed during interaction
  const scalePulse = 1 + Math.sin(t * 3 + phase) * 0.025 * hotspot * pulseMultiplier;
  group.scale.setScalar(scalePulse);
}

// ── Query trail (arc particle) ────────────────────────────────────────────────

export interface QueryTrail {
  id: string;
  line: THREE.Line;
  particles: THREE.Points;
  startTime: number;
  duration: number;
  progress: number;
  positions: Float32Array;
  curve: THREE.QuadraticBezierCurve3;
}

const TRAIL_DURATION       = 3200; // longer decay — no visual pop on removal
const TRAIL_PARTICLE_COUNT = 10;

export function createQueryTrail(
  id: string,
  srcPos: THREE.Vector3,
  dstPos: THREE.Vector3,
  color: THREE.Color,
): QueryTrail {
  const mid = new THREE.Vector3()
    .addVectors(srcPos, dstPos)
    .multiplyScalar(0.5)
    .add(new THREE.Vector3(
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25,
    ));

  const curve = new THREE.QuadraticBezierCurve3(srcPos, mid, dstPos);

  const arcPoints = curve.getPoints(40);
  const arcGeo    = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const arcMat    = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22, linewidth: 1 });
  const line      = new THREE.Line(arcGeo, arcMat);

  const positions   = new Float32Array(TRAIL_PARTICLE_COUNT * 3);
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color, size: 1.6, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeo, particleMat);

  return { id, line, particles, startTime: Date.now(), duration: TRAIL_DURATION, progress: 0, positions, curve };
}

export function animateQueryTrail(trail: QueryTrail): boolean {
  const elapsed = Date.now() - trail.startTime;
  if (elapsed >= trail.duration) return false;

  trail.progress = elapsed / trail.duration;
  const head = trail.progress;

  for (let i = 0; i < TRAIL_PARTICLE_COUNT; i++) {
    const t = Math.max(0, head - i * 0.07);
    const p = t <= 0 ? trail.curve.getPoint(0) : trail.curve.getPoint(t);
    trail.positions[i * 3]     = p.x;
    trail.positions[i * 3 + 1] = p.y;
    trail.positions[i * 3 + 2] = p.z;
  }

  (trail.particles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (trail.line.material     as THREE.LineBasicMaterial).opacity  = 0.22 * (1 - trail.progress);
  (trail.particles.material as THREE.PointsMaterial).opacity    = 0.85 * (1 - trail.progress * 0.75);
  return true;
}
