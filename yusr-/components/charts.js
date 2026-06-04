// رسومات Canvas خفيفة بدون مكتبات خارجية حتى تبقى الإحصائيات سريعة وبسيطة.
export function drawDonut(canvas, values, colors) {
  const context = setup(canvas);
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const width = context.logicalWidth;
  const height = context.logicalHeight;
  const size = Math.min(width, height);
  const radius = size * 0.34;
  let start = -Math.PI / 2;
  context.lineWidth = size * 0.12;
  context.lineCap = "round";
  values.forEach((value, index) => {
    const angle = (value / total) * Math.PI * 2;
    context.beginPath();
    context.strokeStyle = colors[index];
    context.arc(width / 2, height / 2, radius, start, start + angle);
    context.stroke();
    start += angle;
  });
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink");
  context.font = `700 ${size * 0.09}px Tajawal`;
  context.textAlign = "center";
  context.fillText(`${Math.round((values[0] / total) * 100)}%`, width / 2, height / 2 + 8);
}

export function drawBars(canvas, rows, color = "#2563eb") {
  const context = setup(canvas);
  const widthTotal = context.logicalWidth;
  const max = Math.max(...rows.map((row) => row.value), 1);
  const width = widthTotal - 72;
  const barHeight = 26;
  const gap = 18;
  context.font = "500 24px Tajawal";
  rows.slice(0, 5).forEach((row, index) => {
    const y = 34 + index * (barHeight + gap);
    context.fillStyle = "rgba(148, 163, 184, .18)";
    roundRect(context, 20, y, width, barHeight, 13);
    context.fill();
    context.fillStyle = color;
    roundRect(context, 20, y, Math.max(12, (row.value / max) * width), barHeight, 13);
    context.fill();
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink");
    context.textAlign = "right";
    context.fillText(row.label, widthTotal - 20, y - 5);
  });
}

function setup(canvas) {
  // نضبط دقة الرسم حسب devicePixelRatio حتى لا تظهر الرسوم ضبابية على شاشات الجوال.
  const ratio = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);
  context.logicalWidth = rect.width;
  context.logicalHeight = rect.height;
  return context;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
