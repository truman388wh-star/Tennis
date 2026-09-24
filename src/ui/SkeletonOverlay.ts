// Draws the detected pose over the video. The canvas matches the displayed
// video box (object-fit: contain), so landmarks line up with the image.

import type { PoseFrame } from '../types';
import { SKELETON_EDGES, dominantArm } from '../pose/landmarks';
import type { Handedness } from '../types';

export class SkeletonOverlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(frame: PoseFrame, handedness: Handedness, mirrored: boolean, minVisibility: number, highlight: boolean): void {
    const { canvas, ctx } = this;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const hgt = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    ctx.clearRect(0, 0, w, hgt);

    // Fit the frame (aspect) into the canvas like object-fit: contain.
    const boxAspect = w / hgt;
    const drawW = frame.aspect > boxAspect ? w : hgt * frame.aspect;
    const drawH = frame.aspect > boxAspect ? w / frame.aspect : hgt;
    const ox = (w - drawW) / 2;
    const oy = (hgt - drawH) / 2;
    const px = (x: number) => {
      const nx = x / frame.aspect;
      return ox + (mirrored ? 1 - nx : nx) * drawW;
    };
    const py = (y: number) => oy + y * drawH;

    const lm = frame.landmarks;
    const dom = dominantArm(handedness);
    const domEdges = new Set([`${dom.shoulder}-${dom.elbow}`, `${dom.elbow}-${dom.wrist}`]);
    ctx.lineCap = 'round';
    for (const [a, b] of SKELETON_EDGES) {
      const pa = lm[a];
      const pb = lm[b];
      if (!pa || !pb || pa.visibility < minVisibility || pb.visibility < minVisibility) continue;
      const isDom = domEdges.has(`${a}-${b}`);
      ctx.strokeStyle = isDom ? (highlight ? '#ffd23f' : '#7cf29a') : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = (isDom ? 5 : 3) * dpr;
      ctx.beginPath();
      ctx.moveTo(px(pa.x), py(pa.y));
      ctx.lineTo(px(pb.x), py(pb.y));
      ctx.stroke();
    }
    const wrist = lm[dom.wrist];
    if (wrist && wrist.visibility >= minVisibility) {
      ctx.fillStyle = highlight ? '#ffd23f' : '#7cf29a';
      ctx.beginPath();
      ctx.arc(px(wrist.x), py(wrist.y), 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
