import { useRef, useEffect } from 'react';

interface KpiCardProps {
  label: string;
  value: string;
  valueClass: string;
  sub?: string;
  subClass?: string;
  badge?: string;
}

function KpiCard({ label, value, valueClass, sub, subClass, badge }: KpiCardProps) {
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <p className="text-text-muted text-sm mb-2">{label}</p>
      <p className={`${valueClass} font-bold`}>{value}</p>
      {badge && (
        <span className="mt-1 inline-block text-xs bg-emerald-dim text-emerald px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      {sub && <p className={`mt-1 text-sm ${subClass ?? 'text-text-muted'}`}>{sub}</p>}
    </div>
  );
}

const TREND_DATA = [180000, 210000, 238000, 255000, 270000, 284000];
const TREND_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

function CostTrendChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = container.offsetWidth;
    const cssHeight = 200;

    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const paddingLeft = 60;
    const paddingTop = 20;
    const paddingBottom = 32;
    const paddingRight = 20;

    const chartW = cssWidth - paddingLeft - paddingRight;
    const chartH = cssHeight - paddingTop - paddingBottom;

    const maxVal = 300000;
    const minVal = 0;
    const range = maxVal - minVal;

    const toX = (i: number) => paddingLeft + (i / (TREND_DATA.length - 1)) * chartW;
    const toY = (v: number) => paddingTop + chartH - ((v - minVal) / range) * chartH;

    const yLabels: { val: number; label: string }[] = [
      { val: 0, label: '$0' },
      { val: 100000, label: '$100K' },
      { val: 200000, label: '$200K' },
      { val: 300000, label: '$300K' },
    ];
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#5A8FAA';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yLabels.forEach(({ val, label }) => {
      ctx.fillText(label, paddingLeft - 8, toY(val));
      ctx.save();
      ctx.strokeStyle = '#132842';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, toY(val));
      ctx.lineTo(paddingLeft + chartW, toY(val));
      ctx.stroke();
      ctx.restore();
    });

    const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartH);
    gradient.addColorStop(0, 'rgba(0,200,255,0.18)');
    gradient.addColorStop(1, 'rgba(0,200,255,0.02)');

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(TREND_DATA[0]));
    TREND_DATA.forEach((v, i) => {
      if (i > 0) ctx.lineTo(toX(i), toY(v));
    });
    ctx.lineTo(toX(TREND_DATA.length - 1), toY(0));
    ctx.lineTo(toX(0), toY(0));
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.save();
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00C8FF';
    ctx.strokeStyle = '#00C8FF';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    TREND_DATA.forEach((v, i) => {
      if (i === 0) ctx.moveTo(toX(i), toY(v));
      else ctx.lineTo(toX(i), toY(v));
    });
    ctx.stroke();
    ctx.restore();

    TREND_DATA.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(toX(i), toY(v), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00C8FF';
      ctx.fill();
    });

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = '#5A8FAA';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    TREND_MONTHS.forEach((m, i) => {
      ctx.fillText(m, toX(i), paddingTop + chartH + 8);
    });
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}

const HEDIS = [
  { measure: 'Comprehensive Diabetes Care — HbA1c Control', current: 61, benchmark: 58, status: 'above' as const },
  { measure: 'Controlling High Blood Pressure', current: 72, benchmark: 75, status: 'below' as const },
  { measure: 'Care for Older Adults — Functional Status', current: 84, benchmark: 80, status: 'above' as const },
  { measure: 'Follow-up After ED Visit for Mental Illness', current: 68, benchmark: 70, status: 'below' as const },
  { measure: 'Transitions of Care', current: 77, benchmark: 74, status: 'above' as const },
];

function HedisRow({ measure, current, benchmark, status }: typeof HEDIS[number]) {
  const isAbove = status === 'above';
  const fillColor = isAbove ? '#0FC48A' : '#E84848';
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-text text-sm font-medium">{measure}</p>
        <span
          className="ml-4 shrink-0 text-xs font-medium"
          style={{ color: fillColor }}
        >
          {isAbove ? 'Above ↑' : 'Below ↓'}
        </span>
      </div>
      <div className="bg-surface-raised h-2 rounded-full w-full overflow-hidden mb-1">
        <div
          className="h-full rounded-full"
          style={{ width: `${current}%`, backgroundColor: fillColor }}
        />
      </div>
      <p className="text-xs">
        <span className="font-bold" style={{ color: fillColor }}>{current}%</span>
        <span className="text-text-muted ml-1">(benchmark: {benchmark}%)</span>
      </p>
    </div>
  );
}

export default function CostROI() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-text mb-6">Cost &amp; ROI</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Cost Avoidance YTD"
          value="$284,000"
          valueClass="text-emerald text-3xl"
          badge="▲ vs prior year"
        />
        <KpiCard
          label="Readmissions Prevented"
          value="34"
          valueClass="text-cyan text-3xl"
          sub="this year"
        />
        <KpiCard
          label="Readmission Rate"
          value="14.2%"
          valueClass="text-emerald text-2xl"
          sub="↓ vs 18.1% benchmark"
          subClass="text-emerald text-sm"
        />
        <KpiCard
          label="ED Visits Avoided"
          value="52"
          valueClass="text-violet text-3xl"
          sub="this year"
        />
      </div>

      <div className="bg-surface border border-border rounded-xl p-5 mb-6">
        <p className="text-text font-semibold mb-4">Cost Avoidance Trend (YTD)</p>
        <CostTrendChart />
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-text font-semibold mb-4">HEDIS Quality Measures</p>
        {HEDIS.map((row) => (
          <HedisRow key={row.measure} {...row} />
        ))}
      </div>
    </div>
  );
}
