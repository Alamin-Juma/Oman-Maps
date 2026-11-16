import { useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, ShaderMaterial, Shape, ShapeGeometry, Vector2 } from "three";
import type { ContentPack, Locale } from "@dunialab/content";
import { t } from "../lib/packs.js";
import { device3d } from "../lib/device3d.js";
import { chooseTier } from "./plan.js";
import { loadScene, type LoadedScene } from "./load.js";
import { localFrame, lonToTileX, latToTileY, tileXToLon, tileYToLat, type LonLat } from "./geo.js";
import { buildGrid, buildRibbon, lakeShapePoints, sampleGrid } from "./terrain.js";
import "./viewer.css";

interface Props {
  pack: ContentPack;
  featureId: string | null;
  locale: Locale;
  onClose(): void;
  onSelect(featureId: string | null): void;
}

const vertexShader = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aHeight; attribute float aSkirt;
uniform float uExag; uniform float uBase;
varying vec2 vUv; varying float vSkirt; varying float vDist;
void main() {
  vec3 p = position;
  p.y = mix(aHeight * uExag, uBase, aSkirt);
  vUv = uv; vSkirt = aSkirt;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const fragmentShader = `
#include <logdepthbuf_pars_fragment>
uniform sampler2D uAlbedo; uniform sampler2D uShade;
uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying float vSkirt; varying float vDist;
void main() {
  #include <logdepthbuf_fragment>
  vec3 c = texture2D(uAlbedo, vUv).rgb * texture2D(uShade, vUv).r * 1.18;
  c = mix(c, c * 0.45 + vec3(0.18, 0.13, 0.09), vSkirt);
  float f = smoothstep(uFogNear, uFogFar, vDist) * 0.55;
  gl_FragColor = vec4(mix(c, uFog, f), 1.0);
}`;

function makeScene(data: LoadedScene) {
  const { plan, manifest } = data;
  const { toLocal } = localFrame(plan.focus);
  const uExag = { value: plan.exaggeration.from };
  const sources = plan.patch
    ? [{
        dir: plan.patch.dir,
        size: plan.patch.heightSize,
        at: (u: number, v: number): LonLat => {
          const [[w, s], [e, n]] = plan.patch!.bounds;
          return [w + u * (e - w), n - v * (n - s)];
        },
        uv: ([lon, lat]: LonLat): [number, number] => {
          const [[w, s], [e, n]] = plan.patch!.bounds;
          return [(lon - w) / (e - w), (n - lat) / (n - s)];
        },
      }]
    : plan.tiles.map(({ x, y, z }) => ({
        dir: `tiles/${z}/${x}/${y}`,
        size: plan.mode === "overview" ? manifest.overview.heightSize : manifest.regional.heightSize,
        at: (u: number, v: number): LonLat => [tileXToLon(x + u, z), tileYToLat(y + v, z)],
        uv: ([lon, lat]: LonLat): [number, number] => [lonToTileX(lon, z) - x, latToTileY(lat, z) - y],
      }));
  const terrains = sources.map((source) => {
    const grid = data.grids.get(`${source.dir}/h.webp`)!;
    if (grid.size !== source.size) throw new Error("Height grid does not match the manifest");
    const arrays = buildGrid({ ...grid, stride: plan.meshStride, lonLatAt: source.at, toLocal, withSkirt: !!plan.patch });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(arrays.positions, 3));
    geometry.setAttribute("aHeight", new BufferAttribute(arrays.heightsKm, 1));
    geometry.setAttribute("aSkirt", new BufferAttribute(arrays.skirt, 1));
    geometry.setAttribute("uv", new BufferAttribute(arrays.uvs, 2));
    geometry.setIndex(new BufferAttribute(arrays.indices, 1));
    const base = { value: 0 };
    const material = new ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: {
        uExag, uBase: base,
        uAlbedo: { value: data.textures.get(`${source.dir}/albedo.webp`)! },
        uShade: { value: data.textures.get(`${source.dir}/shade.webp`)! },
        uFog: { value: new Color().setRGB(207 / 255, 224 / 255, 234 / 255) },
        uFogNear: { value: plan.camera.distanceKm * 0.9 },
        uFogFar: { value: plan.camera.distanceKm * 3.5 },
      },
    });
    const minimum = grid.heights.reduce((min, h) => Math.min(min, h), Infinity) / 1000;
    return { geometry, material, base, minimum };
  });
  const heightAt = (point: LonLat) => {
    for (const source of sources) {
      const [u, v] = source.uv(point);
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        const grid = data.grids.get(`${source.dir}/h.webp`)!;
        return sampleGrid(grid.heights, grid.size, u, v) / 1000;
      }
    }
    // Missing tiles are open sea, and overview labels can be outside an HD patch.
    return 0;
  };
  const lakes = data.lakes.lakes.filter((lake) => plan.lakeIds.includes(lake.featureId)).map((lake) => ({
    ...lake,
    geometry: new ShapeGeometry(new Shape(lakeShapePoints(lake.outline, toLocal).map(([x, y]) => new Vector2(x, y)))).rotateX(-Math.PI / 2),
    group: new Group(),
  }));
  const rivers = data.rivers.rivers.filter((river) => plan.riverIds.includes(river.featureId)).map((river) => {
    const width = (w: number) => plan.mode === "overview" ? 2.5 + 4 * w : plan.mode === "region" ? 0.4 + 1.2 * w : 0.15 + 0.5 * w;
    const arrays = buildRibbon(river.points, toLocal, width, 6);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(arrays.positions, 3));
    geometry.setAttribute("aHeight", new BufferAttribute(arrays.heightsKm, 1));
    geometry.setIndex(new BufferAttribute(arrays.indices, 1));
    const material = new ShaderMaterial({
      uniforms: { uExag },
      side: DoubleSide,
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aHeight; uniform float uExag;
        void main() { vec3 p = position; p.y = aHeight * uExag;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          gl_FragColor = vec4(0.184, 0.498, 0.816, 1.0);
        }`,
    });
    return { geometry, material };
  });
  const labels = plan.labels.map((label) => {
    const group = new Group();
    const [x, z] = toLocal(label.anchor);
    group.position.set(x, 0, z);
    return { ...label, group, height: heightAt(label.anchor) };
  });
  return {
    terrains, lakes, rivers, labels, uExag, focusHeight: heightAt(plan.focus),
    dispose() {
      for (const mesh of [...terrains, ...rivers]) { mesh.geometry.dispose(); mesh.material.dispose(); }
      for (const lake of lakes) lake.geometry.dispose();
    },
  };
}

function Scene({ data, locale, onSelect, container, labelPortal, onError }: {
  data: LoadedScene; locale: Locale; onSelect: Props["onSelect"];
  container: RefObject<HTMLDivElement | null>; labelPortal: RefObject<HTMLDivElement | null>; onError(): void;
}) {
  const { plan } = data;
  const scene = useMemo(() => makeScene(data), [data]);
  const { camera, gl } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const elapsed = useRef(0);
  const frames = useRef(0);
  const finished = useRef(false);
  useEffect(() => {
    for (const texture of data.textures.values()) {
      texture.anisotropy = gl.capabilities.getMaxAnisotropy();
      texture.needsUpdate = true;
    }
    const lost = (event: Event) => { event.preventDefault(); onError(); };
    gl.domElement.addEventListener("webglcontextlost", lost);
    return () => { gl.domElement.removeEventListener("webglcontextlost", lost); scene.dispose(); };
  }, [data, gl, scene, onError]);

  useFrame((_, delta) => {
    if (!finished.current) {
      // Start from flat on the first frame, even when shader compilation took a while.
      if (frames.current > 0) elapsed.current += delta * 1000;
      const progress = plan.exaggeration.durationMs === 0 ? 1 : Math.min(1, elapsed.current / plan.exaggeration.durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const exag = plan.exaggeration.from + (plan.exaggeration.to - plan.exaggeration.from) * eased;
      scene.uExag.value = exag;
      for (const terrain of scene.terrains) terrain.base.value = terrain.minimum * exag - 0.6;
      for (const lake of scene.lakes) lake.group.position.y = (lake.surfaceMetres + 4) / 1000 * exag;
      for (const label of scene.labels) label.group.position.y = label.height * exag + (plan.mode === "overview" ? 15 : plan.mode === "region" ? 3 : 0.8);
      const distance = plan.camera.distanceKm * (1 + 0.8 * (1 - eased));
      const pitch = (plan.camera.pitchDeg + 20 * (1 - eased)) * Math.PI / 180;
      const heading = plan.camera.headingDeg * Math.PI / 180;
      const height = scene.focusHeight * exag;
      camera.position.set(Math.sin(heading) * Math.cos(pitch) * distance, height + Math.sin(pitch) * distance, Math.cos(heading) * Math.cos(pitch) * distance);
      camera.lookAt(0, height, 0);
      if (controls.current) {
        controls.current.target.set(0, height, 0);
        controls.current.enabled = progress === 1;
        controls.current.update();
      }
      if (container.current) container.current.dataset.exaggeration = exag.toFixed(2);
      finished.current = progress === 1;
    }
    // The previous frame has been rendered by Fiber before readiness is advertised.
    if (frames.current++ > 0 && container.current) container.current.dataset.sceneReady = "true";
  });

  return <>
    <OrbitControls ref={controls} makeDefault enabled={plan.exaggeration.durationMs === 0} enablePan={false}
      minDistance={plan.camera.distanceKm * 0.25} maxDistance={plan.camera.distanceKm * 2.5} maxPolarAngle={Math.PI * 80 / 180} />
    {scene.terrains.map((mesh, i) => <mesh key={i} geometry={mesh.geometry} material={mesh.material} frustumCulled={false} dispose={null} />)}
    {plan.mode !== "patch" && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
      <planeGeometry args={[12000, 12000]} /><meshBasicMaterial color={new Color().setRGB(52 / 255, 104 / 255, 152 / 255)} />
    </mesh>}
    {scene.lakes.map((lake) => <primitive object={lake.group} key={lake.featureId}>
      <mesh geometry={lake.geometry} frustumCulled={false}><meshBasicMaterial color={new Color().setRGB(61 / 255, 132 / 255, 198 / 255)} opacity={0.85} transparent /></mesh>
    </primitive>)}
    {scene.rivers.map((river, i) => <mesh key={i} geometry={river.geometry} material={river.material} frustumCulled={false} dispose={null} />)}
    {scene.labels.map((label) => <primitive object={label.group} key={label.featureId}>
      <Html center {...(labelPortal.current ? { portal: { current: labelPortal.current } } : {})} zIndexRange={[20, 0]}>
        <button className="viewer3d-label" onClick={() => onSelect(label.featureId)}>{t(label.text, locale)}</button>
      </Html>
    </primitive>)}
  </>;
}

export default function Viewer3D({ pack, featureId, locale, onClose, onSelect }: Props) {
  const [data, setData] = useState<LoadedScene | null>(null);
  const [error, setError] = useState(false);
  const [notices, setNotices] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const labelPortal = useRef<HTMLDivElement>(null);
  const tier = chooseTier(device3d());
  const onError = useMemo(() => () => setError(true), []);
  useEffect(() => {
    const controller = new AbortController();
    let loaded: LoadedScene | undefined;
    void loadScene(pack, featureId, tier, matchMedia("(prefers-reduced-motion: reduce)").matches, controller.signal).then((value) => {
      if (controller.signal.aborted) { value.dispose(); return; }
      loaded = value;
      setData(value);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) { console.error(cause); setError(true); }
    });
    return () => { controller.abort(); loaded?.dispose(); };
  }, [pack, featureId, tier]);

  return <div ref={container} className="viewer3d" data-mode={data?.plan.mode} data-exaggeration={data?.plan.exaggeration.from.toFixed(2)}>
    <div className="viewer3d-actions">
      <button onClick={onClose}>{locale === "sw" ? "Rudi kwenye ramani" : "Back to map"}</button>
      {featureId && <button onClick={() => onSelect(null)}>{locale === "sw" ? "Ramani nzima" : "Whole map"}</button>}
    </div>
    {error ? <p className="viewer3d-status" role="alert">{locale === "sw" ? "3D haipatikani kwa ramani hii kwa sasa" : "3D is not available for this map yet"}</p>
      : data ? <div className="viewer3d-canvas"><div className="viewer3d-labels" ref={labelPortal} /><Canvas flat linear dpr={[1, tier === "high" ? 2 : 1.5]}
          gl={{ antialias: tier !== "low", alpha: true, logarithmicDepthBuffer: true }} camera={{ fov: 45, near: 0.1, far: 6000 }}>
          <Scene data={data} locale={locale} onSelect={onSelect} container={container} labelPortal={labelPortal} onError={onError} />
        </Canvas></div>
      : <p className="viewer3d-status" role="status">{locale === "sw" ? "Inapakia 3D..." : "Loading 3D..."}</p>}
    {data && <section className="viewer3d-card">
      <strong>{t(data.plan.title, locale)}</strong>
      {data.plan.facts.map((fact, i) => <p key={i}>{t(fact, locale)}</p>)}
      <p className="muted">{t(data.plan.exaggerationNote, locale)}</p>
      <button className="chip" aria-expanded={notices} onClick={() => setNotices(!notices)}>{locale === "sw" ? "Data ya ramani" : "Map data"}</button>
      {notices && <ul>{data.manifest.sources.flatMap((source) => source.notices).map((notice, i) => <li key={i}>{notice}</li>)}</ul>}
    </section>}
  </div>;
}
