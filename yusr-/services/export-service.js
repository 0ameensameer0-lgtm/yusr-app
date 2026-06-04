import { downloadBlob, safeNumber } from "../utils/dom.js?v=35";

export function exportAttendanceCsv(subject, students, attendance) {
  const rows = [["#", "الطالب", "الحالة"], ...students.map((student, index) => [index + 1, student.name, statusLabel(attendance[student.id])])];
  downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), `كشف-حضور-${subject.name}.csv`);
}

export function exportGradesCsv(subject, students, columns, getGrades) {
  const rows = [["#", "الطالب", ...columns.map((column) => column.label), "المجموع"]];
  students.forEach((student, index) => {
    const grades = getGrades(student.id);
    const total = columns.reduce((sum, column) => sum + safeNumber(grades[column.id]), 0);
    rows.push([index + 1, student.name, ...columns.map((column) => grades[column.id] ?? 0), total]);
  });
  downloadBlob(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }), `كشف-درجات-${subject.name}.csv`);
}

export function exportReportPdf(subject, html, title = "تقرير", options = {}) {
  const isMonthlyReport = html.includes("monthly-report");
  const pageSize = isMonthlyReport ? "A4 landscape" : "A4 portrait";
  const popupSize = isMonthlyReport ? "width=1280,height=720" : "width=960,height=720";
  const calendar = options.calendar === "islamic" ? "islamic-umalqura" : "gregory";
  const exportDate = new Intl.DateTimeFormat("ar-SA", { dateStyle: "full", timeStyle: "short", calendar }).format(new Date());
  const popup = window.open("", "_blank", popupSize);
  popup.document.write(`
    <html lang="ar" dir="rtl">
      <head>
        <title>${title} ${subject.name}</title>
        <style>
          @page{size:${pageSize};margin:8mm}
          *{box-sizing:border-box}
          html,body{width:100%;min-height:100%;margin:0}
          body{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#111827;background:white;font-variant-numeric:tabular-nums}
          .print-page{width:100%;max-width:none;padding:0}
          .report-cover{border:1px solid #dbeafe;background:#f8fbff;border-radius:8px;padding:10px 12px;margin-bottom:12px}
          h1{color:#1d4ed8;margin:0 0 6px;font-size:22px;font-weight:900}
          h2{margin:0 0 12px;color:#1f2937;font-size:16px;font-weight:900}
          h3{margin:14px 0 8px;color:#1d4ed8;font-size:14px;font-weight:900}
          table{width:100%;max-width:100%;border-collapse:collapse;margin-top:8px;margin-bottom:12px;page-break-inside:auto;table-layout:fixed}
          thead{display:table-header-group}
          tbody{display:table-row-group}
          tr{page-break-inside:auto;break-inside:auto}
          td,th{border:1px solid #d6deea;padding:6px 5px;text-align:center;font-size:10.5px;line-height:1.35;white-space:normal;overflow-wrap:anywhere;word-break:normal}
          th:first-child,td:first-child{width:30px;text-align:center}
          th:nth-child(2),td:nth-child(2){width:170px;text-align:right;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
          tbody tr:nth-child(even) td{background:#fbfdff}
          .monthly-report{table-layout:fixed}
          .monthly-report-section{break-after:page;page-break-after:always}
          .monthly-report-section:last-child{break-after:auto;page-break-after:auto}
          .monthly-report th:not(:first-child):not(:nth-child(2)),
          .monthly-report td:not(:first-child):not(:nth-child(2)){width:24px;padding:3px 1px;font-size:8.5px;line-height:1.15}
          .monthly-report th:nth-child(2),
          .monthly-report td:nth-child(2){width:190px;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
          .monthly-report thead th{height:86px;vertical-align:bottom}
          .monthly-report .vertical-day{display:inline-flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;writing-mode:vertical-rl;text-orientation:mixed;white-space:nowrap;line-height:1}
          .monthly-report .vertical-day b{font-size:8px;font-weight:800}
          .monthly-report .vertical-day em{font-size:9px;font-style:normal;font-weight:900}
          .monthly-report .vertical-day small{font-size:7px;font-weight:800;color:#374151}
          .stats-report h2,.pdf-section-title{margin:16px 0 8px;color:#1d4ed8;font-size:15px;font-weight:900}
          .stats-report table{margin:8px 0 14px}
          .wide-name{width:auto;text-align:right}
          .pdf-name-list{display:grid;gap:0;text-align:right;max-height:none}
          .pdf-name-list span{display:block;padding:3px 2px;border-bottom:1px solid #eef2f7;line-height:1.45}
          .pdf-name-list span:last-child{border-bottom:0}
          .pdf-stacked-list{display:grid;gap:0;text-align:right}
          .pdf-stacked-list span{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 2px;border-bottom:1px solid #eef2f7;line-height:1.45}
          .pdf-stacked-list span:last-child{border-bottom:0}
          .pdf-stacked-list b{color:#1d4ed8;font-weight:900;white-space:nowrap}
          .pdf-tight-table th,.pdf-tight-table td{padding:5px 4px;font-size:10px}
          .pdf-tight-table,.ranking-report,.distribution-report,.column-analysis-report{table-layout:auto}
          .manager-reports-pdf table,.manager-reports-pdf .pdf-tight-table{table-layout:auto;width:auto;min-width:62%;max-width:100%}
          .manager-reports-pdf th,.manager-reports-pdf td{white-space:nowrap;overflow-wrap:normal;word-break:keep-all;padding:7px 10px}
          .manager-reports-pdf th:first-child,.manager-reports-pdf td:first-child{width:auto;min-width:130px;text-align:right}
          .manager-reports-pdf th:nth-child(2),.manager-reports-pdf td:nth-child(2){width:auto;min-width:120px;text-align:right}
          .manager-reports-pdf th:nth-child(3),.manager-reports-pdf td:nth-child(3){width:auto;min-width:120px;text-align:right}
          .behavior-pdf-table{table-layout:auto;width:100%}
          .behavior-pdf-table th{white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
          .behavior-pdf-table td{white-space:normal;overflow-wrap:break-word;word-break:normal}
          .behavior-pdf-table .behavior-col-index{width:28px}
          .behavior-pdf-table .behavior-col-date{width:96px}
          .behavior-pdf-table .behavior-col-subject{width:72px}
          .behavior-pdf-table .behavior-col-degree{width:92px}
          .behavior-pdf-table .behavior-col-violation{width:24%}
          .behavior-pdf-table .behavior-col-action{width:15%}
          .behavior-pdf-table .behavior-col-penalty{width:24%}
          .behavior-pdf-table .behavior-col-points{width:52px}
          .behavior-pdf-table .behavior-col-status{width:72px}
          .behavior-student-info-table{table-layout:auto}
          .behavior-student-info-table th{width:92px;min-width:92px;white-space:nowrap;text-align:right}
          .behavior-student-info-table td{min-width:180px;text-align:right;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
          .pdf-tight-table th:nth-child(2),.pdf-tight-table td:nth-child(2),
          .ranking-report th:nth-child(2),.ranking-report td:nth-child(2),
          .distribution-report th:nth-child(2),.distribution-report td:nth-child(2),
          .column-analysis-report th:nth-child(2),.column-analysis-report td:nth-child(2){width:auto;min-width:220px;text-align:right;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
          .behavior-pdf-table th:nth-child(2),.behavior-pdf-table td:nth-child(2){width:82px;min-width:82px;text-align:center;white-space:nowrap}
          .behavior-pdf-table th:nth-child(3),.behavior-pdf-table td:nth-child(3){width:84px;min-width:84px;text-align:center;white-space:nowrap}
          .behavior-pdf-table th:nth-child(4),.behavior-pdf-table td:nth-child(4){width:96px;min-width:96px;text-align:center}
          .ranking-report th:first-child,.ranking-report td:first-child,
          .distribution-report th:first-child,.distribution-report td:first-child{width:30px;text-align:center}
          .distribution-report th:nth-child(3),.distribution-report td:nth-child(3),
          .distribution-report th:nth-child(4),.distribution-report td:nth-child(4){width:62px;text-align:center;white-space:nowrap}
          .column-analysis-section,.distribution-report-section{break-inside:avoid;page-break-inside:avoid;margin-bottom:12px}
          .column-analysis-section h3,.distribution-report-section h3{margin:10px 0 6px;padding:6px 8px;border:1px solid #dbeafe;border-radius:6px;background:#f8fbff;color:#1d4ed8}
          .pdf-subtitle{margin:8px 0 4px;color:#374151;font-size:12px;font-weight:900}
          .column-analysis-report th:first-child,.column-analysis-report td:first-child{width:30px;text-align:center}
          .column-analysis-report th:nth-child(3),.column-analysis-report td:nth-child(3){width:68px;text-align:center;color:#1d4ed8;font-weight:900;white-space:nowrap}
          .column-analysis-report th:nth-child(4),.column-analysis-report td:nth-child(4){width:96px;text-align:center;white-space:nowrap}
          .grades-report th:first-child,.grades-report td:first-child{width:30px}
          .grades-report th:nth-child(2),.grades-report td:nth-child(2){width:170px;text-align:right;white-space:nowrap;overflow-wrap:normal;word-break:keep-all}
          .grades-report .total-cell{font-weight:900;color:#1d4ed8;background:#eff6ff}
          .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 12px}
          .summary-card{border:1px solid #dbeafe;background:#f8fbff;border-radius:8px;padding:8px;text-align:center}
          .summary-card span{display:block;color:#64748b;font-size:10px;margin-bottom:4px}
          .summary-card strong{font-size:16px;color:#1d4ed8}
          th{background:#eef4ff;color:#1d4ed8;font-weight:900}
          .meta{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 0;color:#4b5563;font-size:12px}
          .badge{display:inline-block;border-radius:999px;padding:3px 8px;font-weight:bold}
          .present{background:#dcfce7;color:#15803d}.absent{background:#fee2e2;color:#b91c1c}.late{background:#fef3c7;color:#b45309}.empty{background:#f3f4f6;color:#6b7280}
          @media print{
            body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
            .print-page{width:100%}
          }
        </style>
      </head>
      <body>
        <main class="print-page">
          <section class="report-cover">
            <h1>${title}</h1>
            <h2>${subject.name}</h2>
            <div class="meta"><span>تاريخ التصدير: ${exportDate}</span></div>
          </section>
          ${html}
        </main>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

function toCsv(rows) {
  return "\uFEFF" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}

function statusLabel(status) {
  return status === "present" ? "حاضر" : status === "absent" ? "غائب" : status === "late" ? "متأخر" : "غير محدد";
}
