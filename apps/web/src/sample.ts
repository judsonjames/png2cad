import { drawingSurface } from "./canvas";

/** A made-up two-color badge, drawn on the spot, so anyone can try the app without a file of their own. */
export async function makeSample(): Promise<Blob> {
  const surface = drawingSurface(800, 800);
  const g = surface.context;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 800, 800);
  g.fillStyle = "#123f6d";
  g.beginPath();
  g.arc(400, 400, 340, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(400, 400, 290, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#d62828";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(400 + Math.cos(a) * 170, 400 + Math.sin(a) * 170);
    g.rotate(a);
    g.fillRect(-54, -26, 108, 52);
    g.restore();
  }
  g.fillStyle = "#123f6d";
  g.beginPath();
  g.arc(400, 400, 120, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = "bold 150px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("P2", 400, 408);
  return surface.toPng();
}
