import { Button, EmptyState, Select, useMediaQuery } from "@png2cad/ui/components";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlatePart } from "../protocol";
import { useApp } from "../store";

function Scene({ parts }: { parts: PlatePart[] }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, -2, 3);
    scene.add(sun);
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(p.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(p.triangles, 1));
      const flat = g.toNonIndexed();
      flat.computeVertexNormals();
      g.dispose();
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(p.color[0] / 255, p.color[1] / 255, p.color[2] / 255),
        roughness: 0.7,
      });
      geometries.push(flat);
      materials.push(m);
      group.add(new THREE.Mesh(flat, m));
    }
    scene.add(group);
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    const span = bounds.getSize(new THREE.Vector3()).length();
    const camera = new THREE.PerspectiveCamera(35, 1, span / 100, span * 20);
    camera.up.set(0, 0, 1);
    camera.position.set(center.x, center.y - span * 1.1, center.z + span * 1.1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.update();
    const draw = () => renderer.render(scene, camera);
    const size = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      draw();
    };
    controls.addEventListener("change", draw);
    const watch = new ResizeObserver(size);
    watch.observe(el);
    size();
    return () => {
      watch.disconnect();
      controls.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [parts]);
  return <div ref={host} className="app-scene" role="img" aria-label="3D view of the plate. Drag to turn it." />;
}

export default function PlateView() {
  const result = useApp((s) => s.result);
  const busy = useApp((s) => s.exportBusy);
  const exportFiles = useApp((s) => s.exportFiles);
  const plates = (result?.nozzles ?? []).filter((n) => n.parts);
  const touch = useMediaQuery("(pointer: coarse)");
  const [picked, setPicked] = useState<number | null>(null);
  const current = plates.find((n) => n.nozzleMm === picked) ?? plates[0];
  if (!current?.parts) {
    return (
      <EmptyState
        title={busy ? "Building the Plate…" : "No Plate Yet"}
        action={
          busy ? undefined : (
            <Button variant="primary" onClick={() => void exportFiles()}>
              Build the Plate
            </Button>
          )
        }
      >
        The plate is built with your files, because it needs the nozzle fit.
      </EmptyState>
    );
  }
  const triangles = current.parts.reduce((n, p) => n + p.triangles.length / 3, 0);
  return (
    <>
      <div className="app-view-bar">
        <span className="app-view-size">{`${current.parts.length} parts, ${triangles.toLocaleString("en-US")} triangles`}</span>
        <span className="app-view-note">
          {touch ? "Drag to turn. Pinch to zoom." : "Drag to turn. Scroll to zoom."}
        </span>
        <span className="app-spacer" />
        {plates.length > 1 && (
          <Select
            aria-label="Plate Shown"
            value={String(current.nozzleMm)}
            onChange={(v) => setPicked(Number(v))}
            options={plates.map((n) => ({ value: String(n.nozzleMm), label: `${n.nozzleMm} mm Nozzle` }))}
          />
        )}
      </div>
      <Scene parts={current.parts} />
    </>
  );
}
