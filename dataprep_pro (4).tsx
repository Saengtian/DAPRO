import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Upload, Database, Layers, CheckSquare, Settings2, 
  Download, History, Check, AlertCircle, Trash2, FileText, 
  ArrowRight, Play, CheckCircle2, List, Plus, BookOpen, 
  Filter, BarChart2, PieChart, Activity, FileSpreadsheet, 
  Box, Sparkles, Loader2, Camera, Settings, XCircle, Menu, FolderOpen, Scissors,
  ChevronDown, ChevronUp, Save
} from 'lucide-react';

const APP_VERSION = "v3.0.2";

// --- Statistical Utility Functions ---
const statUtils = {
    mean: (arr) => arr.reduce((a,b)=>a+b,0)/arr.length,
    variance: (arr, mean) => arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/(arr.length-1 || 1),
    stdDev: (variance) => Math.sqrt(variance),
    median: (arr) => {
        const mid = Math.floor(arr.length / 2);
        const nums = [...arr].sort((a, b) => a - b);
        return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    },
    skewness: (arr, mean, std) => {
        const n = arr.length;
        if(n < 3 || std === 0) return 0;
        let sum3 = arr.reduce((a,b)=>a+Math.pow((b-mean)/std, 3), 0);
        return (n / ((n-1)*(n-2))) * sum3;
    },
    kurtosis: (arr, mean, std) => {
        const n = arr.length;
        if(n < 4 || std === 0) return 0;
        let sum4 = arr.reduce((a,b)=>a+Math.pow((b-mean)/std, 4), 0);
        return ( (n*(n+1)) / ((n-1)*(n-2)*(n-3)) ) * sum4 - ( (3*Math.pow(n-1, 2)) / ((n-2)*(n-3)) );
    },
    // Approximation for Normality (D'Agostino-Pearson omnibus test approximation)
    testNormality: (arr) => {
        if(arr.length < 20) return { isNormal: false, score: 0, text: "ข้อมูลน้อยเกินไป (N<20)" };
        const mean = statUtils.mean(arr);
        const std = statUtils.stdDev(statUtils.variance(arr, mean));
        const skew = statUtils.skewness(arr, mean, std);
        const kurt = statUtils.kurtosis(arr, mean, std);
        
        // Simple heuristic bounds for demonstration
        const isNormal = Math.abs(skew) < 1.0 && Math.abs(kurt) < 1.5;
        const pValApprox = isNormal ? "> 0.05" : "< 0.05";
        return { 
            isNormal, 
            pVal: pValApprox, 
            text: isNormal ? "ข้อมูลมีการแจกแจงแบบปกติ (Normal)" : "ข้อมูลไม่มีการแจกแจงแบบปกติ (Non-Normal)",
            skew: skew.toFixed(3),
            kurt: kurt.toFixed(3)
        };
    },
    calculateIMR: (arr) => {
        let MR = [];
        for(let i=1; i<arr.length; i++) MR.push(Math.abs(arr[i]-arr[i-1]));
        const avgI = statUtils.mean(arr);
        const avgMR = MR.length > 0 ? statUtils.mean(MR) : 0;
        
        // Control Limits formulas (d2 = 1.128, D4 = 3.267 for n=2)
        const uclI = avgI + 3*(avgMR/1.128);
        const lclI = avgI - 3*(avgMR/1.128);
        const uclMR = 3.267 * avgMR;
        
        return { MR, avgI, avgMR, uclI, lclI, uclMR };
    },
    // Welch's T-Test approximation
    tTest: (g1, g2) => {
        const m1 = statUtils.mean(g1), m2 = statUtils.mean(g2);
        const v1 = statUtils.variance(g1, m1), v2 = statUtils.variance(g2, m2);
        const n1 = g1.length, n2 = g2.length;
        if(n1===0 || n2===0) return { t: NaN, pValue: NaN, significant: false };
        const t = Math.abs(m1 - m2) / Math.sqrt((v1/n1) + (v2/n2));
        // df approximation
        const df = Math.pow((v1/n1) + (v2/n2), 2) / ( Math.pow(v1/n1,2)/(n1-1) + Math.pow(v2/n2,2)/(n2-1) );
        // Simplified p-value logic for UI
        const significant = t > 1.96; // Assuming alpha 0.05, large df
        return { t: t.toFixed(3), df: df.toFixed(1), significant, pValue: significant ? "< 0.05" : "> 0.05" };
    },
    // One-way ANOVA approximation
    anova: (groups) => {
        let totalN = 0, globalSum = 0;
        groups.forEach(g => { totalN += g.length; globalSum += g.reduce((a,b)=>a+b,0); });
        const globalMean = globalSum / totalN;
        
        let ssb = 0; // Sum of Squares Between
        let ssw = 0; // Sum of Squares Within
        
        groups.forEach(g => {
            const m = statUtils.mean(g);
            ssb += g.length * Math.pow(m - globalMean, 2);
            ssw += g.reduce((acc, val) => acc + Math.pow(val - m, 2), 0);
        });
        
        const dfb = groups.length - 1;
        const dfw = totalN - groups.length;
        const msb = ssb / (dfb || 1);
        const msw = ssw / (dfw || 1);
        const f = msb / (msw || 1e-9);
        
        const significant = f > 3.0; // Rough heuristic for UI
        return { f: f.toFixed(3), pValue: significant ? "< 0.05" : "> 0.05", significant };
    }
};

const generateId = () => Math.random().toString(36).substring(2, 9);

const TARGET_COLS = [
  "Part Id", "No.", "Date", "Time", "Barcode", "Result", "ErrorCode", 
  "ErrorMessage", "ProductionLine", "Operator", "OrderNumber", "CycleTime"
];

const DEFAULT_SPEC_COLS = [
  { specId: "F200-01", process: "Functional inspection", originalName: "SpeedStepRunCurrentDcm1", displayName: "RC20", unit: "A", lsl: "0.04", usl: "0.07" },
  { specId: "F200-02", process: "Functional inspection", originalName: "SpeedStepMotorSpeedDriver1", displayName: "RPM20", unit: "rpm", lsl: "1800", usl: "2900" },
  { specId: "F200-03", process: "Functional inspection", originalName: "SpeedStepRunCurrentDcm2", displayName: "RC100", unit: "A", lsl: "0.33", usl: "0.4" },
  { specId: "F200-04", process: "Functional inspection", originalName: "SpeedStepMotorSpeedDriver2", displayName: "RPM100", unit: "rpm", lsl: "3900", usl: "5700" }
];

const X3083_PRESETS = [
  { specId: "R0120", process: "Magnet ht insp.", originalName: "Magnet ht 1", displayName: "Magnet ht 1", unit: "mm", lsl: "3.53", usl: "3.65" },
  { specId: "R0130", process: "Magnet ht insp.", originalName: "Magnet ht 2", displayName: "Magnet ht 2", unit: "mm", lsl: "3.53", usl: "3.65" },
  { specId: "R0140", process: "Magnet ht insp.", originalName: "Magnet ht 3", displayName: "Magnet ht 3", unit: "mm", lsl: "3.53", usl: "3.65" },
  { specId: "R0150", process: "Magnet ht insp.", originalName: "Magnet Para", displayName: "Magnet Para", unit: "mm", lsl: "", usl: "0.06" },
  { specId: "R0170", process: "Rotor assy insp.", originalName: "RRO Axial A", displayName: "RRO Axial A", unit: "um", lsl: "", usl: "15" },
  { specId: "R0180", process: "Rotor assy insp.", originalName: "NRRO Axial A", displayName: "NRRO Axial A", unit: "um", lsl: "", usl: "0.5" },
  { specId: "R0190", process: "Rotor assy insp.", originalName: "RRO Axial B", displayName: "RRO Axial B", unit: "um", lsl: "", usl: "15" },
  { specId: "R0200", process: "Rotor assy insp.", originalName: "NRRO Axial B", displayName: "NRRO Axial B", unit: "um", lsl: "", usl: "0.5" },
  { specId: "SPA0470", process: "Fan dims. insp.", originalName: "Cover ht inlet 11", displayName: "Cover ht inlet 11", unit: "mm", lsl: "5.623", usl: "5.973" },
  { specId: "SPA0480", process: "Fan dims. insp.", originalName: "Cover ht inlet 12", displayName: "Cover ht inlet 12", unit: "mm", lsl: "5.623", usl: "5.973" },
  { specId: "SPA0490", process: "Fan dims. insp.", originalName: "Cover ht outlet 1", displayName: "Cover ht outlet 1", unit: "mm", lsl: "6.859", usl: "7.159" },
  { specId: "SPA0500", process: "Fan dims. insp.", originalName: "Cover ht outlet 2", displayName: "Cover ht outlet 2", unit: "mm", lsl: "6.859", usl: "7.159" },
  { specId: "SPA0510", process: "Fan dims. insp.", originalName: "Cover ht outlet 3", displayName: "Cover ht outlet 3", unit: "mm", lsl: "6.859", usl: "7.159" },
  { specId: "SPA0520", process: "Fan dims. insp.", originalName: "Cover ht mounting", displayName: "Cover ht mounting", unit: "mm", lsl: "7.16", usl: "7.51" },
  { specId: "SPA0530", process: "Fan dims. insp.", originalName: "Static Hub ht 1", displayName: "Static Hub ht 1", unit: "mm", lsl: "5.17", usl: "5.67" },
  { specId: "SPA0540", process: "Fan dims. insp.", originalName: "Static Hub ht 2", displayName: "Static Hub ht 2", unit: "mm", lsl: "5.17", usl: "5.67" }
];

const parseExcelRaw = async (arrayBuffer) => {
  const XLSX = await import('https://esm.sh/xlsx');
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  return data.map(row => row.map(cell => String(cell).trim()));
};

const parseCSVRaw = async (file) => {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  return lines.map(line => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i+1] === '"') { current += '"'; i++; }
      else if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
      else { current += char; }
    }
    result.push(current);
    return result.map(c => c.trim());
  });
};

const exportToCSV = (headers, rows, filename) => {
  const escape = (val) => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const headerRow = headers.map(escape).join(',');
  const bodyRows = rows.map(row => headers.map(h => escape(row[h])).join(','));
  const csvContent = [headerRow, ...bodyRows].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const exportToExcel = async (headers, rows, filename) => {
  const XLSX = await import('https://esm.sh/xlsx');
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Cleaned_Data");
  
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(data);
  link.setAttribute('download', filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const exportMasterVars = (masterVars, modelName) => {
  const headers = ["ID", "Process", "Recording Variable", "Display Variable", "Type", "Unit", "LSL", "USL"];
  const rows = masterVars.map(v => ({
      "ID": v.specId || '',
      "Process": v.process || '',
      "Recording Variable": v.originalName || '',
      "Display Variable": v.displayName || '',
      "Type": v.type === 'spec' ? 'Spec' : 'General',
      "Unit": v.unit || '',
      "LSL": v.lsl || '',
      "USL": v.usl || ''
  }));
  exportToCSV(headers, rows, `Master_Variables_${modelName}.csv`);
};

const loadChartJs = async () => {
    const ChartModule = await import('https://esm.sh/chart.js/auto');
    return ChartModule.default;
}

// --- Dynamic Chart Rendering Component ---
const VariableReportCard = ({ varData, index }) => {
    const histRef = useRef(null);
    const iChartRef = useRef(null);
    
    useEffect(() => {
        let histChart = null;
        let iChart = null;

        const renderCharts = async () => {
            const Chart = await loadChartJs();
            
            // 1. Render Distribution Histogram
            if (histRef.current && varData.isNumeric) {
                const ctx = histRef.current.querySelector('canvas').getContext('2d');
                const { nums, mean, std, min, max, lsl, usl, distType } = varData;
                
                const targetValue = (lsl !== '' && usl !== '') ? (parseFloat(lsl) + parseFloat(usl)) / 2 : mean;
                const numBins = window.innerWidth < 768 ? 15 : 25; 
                const binSize = (max - min) / numBins || 1;
                const bins = Array(numBins).fill(0); const labels = [];
                for(let i=0; i<numBins; i++) labels.push((min+i*binSize).toFixed(4));
                nums.forEach(n => { let idx = Math.floor((n-min)/binSize); if(idx>=numBins) idx=numBins-1; if(idx<0) idx=0; bins[idx]++; });

                histChart = new Chart(ctx, {
                    type: 'bar',
                    data: { labels: labels, datasets: [{ label: 'Frequency', data: bins, backgroundColor: '#818cf8', borderColor: '#4f46e5', borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0 }] },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: {display: false}, title: {display: true, text: `Distribution (${distType})`}, tooltip: {backgroundColor: 'rgba(28,25,23,0.9)'} },
                        scales: { x: { ticks: { maxTicksLimit: window.innerWidth < 768 ? 5 : 10 } } }
                    },
                    plugins: [{
                        id: 'specLimits',
                        afterDraw: (chart) => {
                            const {ctx, chartArea: {top, bottom, left, right}} = chart; ctx.save();
                            const drawLine = (val, color, label, isDashed=true) => {
                                const minX = parseFloat(labels[0]), maxX = parseFloat(labels[labels.length-1])+binSize;
                                if(val >= minX && val <= maxX) {
                                    const px = left + ((val-minX)/(maxX-minX))*(right-left);
                                    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.lineWidth=2; ctx.strokeStyle=color; if(isDashed) ctx.setLineDash([5,5]); ctx.stroke();
                                    ctx.fillStyle=color; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.fillText(label, px, top-5);
                                }
                            };
                            if(lsl!=='') drawLine(parseFloat(lsl), '#ef4444', `LSL`);
                            if(usl!=='') drawLine(parseFloat(usl), '#ef4444', `USL`);
                            if(lsl!=='' && usl!=='') drawLine(targetValue, '#10b981', `Target`, false);
                            ctx.restore();
                        }
                    }]
                });
            }

            // 2. Render I-Chart
            if (iChartRef.current && varData.isNumeric && varData.imr) {
                 const ctx = iChartRef.current.querySelector('canvas').getContext('2d');
                 const { nums, imr } = varData;
                 const labels = nums.map((_, i) => i+1);

                 iChart = new Chart(ctx, {
                     type: 'line',
                     data: { 
                         labels, 
                         datasets: [{
                             label: 'Value', data: nums, borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 2, borderWidth: 1.5, fill: false, tension: 0.1
                         }]
                     },
                     options: { 
                         responsive: true, maintainAspectRatio: false,
                         plugins: { legend: {display: false}, title: {display: true, text: 'I-Chart (Individuals)'} },
                         scales: { x: { ticks: { maxTicksLimit: window.innerWidth < 768 ? 5 : 10 } } }
                     },
                     plugins: [{
                         id: 'controlLimits',
                         afterDraw: (chart) => {
                             const {ctx, chartArea: {top, bottom, left, right}, scales: {y}} = chart; ctx.save();
                             const drawLine = (val, color, label) => {
                                 const py = y.getPixelForValue(val);
                                 if (py >= top && py <= bottom) {
                                     ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(right, py); ctx.lineWidth=1; ctx.strokeStyle=color; ctx.stroke();
                                     ctx.fillStyle=color; ctx.font='10px sans-serif'; ctx.textAlign='right'; ctx.fillText(label, right - 5, py - 5);
                                 }
                             };
                             drawLine(imr.uclI, '#ef4444', 'UCL');
                             drawLine(imr.avgI, '#10b981', 'Avg');
                             drawLine(imr.lclI, '#ef4444', 'LCL');
                             ctx.restore();
                         }
                     }]
                 });
            }
        };

        renderCharts();

        return () => {
            if(histChart) histChart.destroy();
            if(iChart) iChart.destroy();
        }
    }, [varData]);

    if (!varData.isNumeric) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                <h3 className="font-bold text-lg text-slate-800 border-b border-slate-100 pb-2 mb-4">{varData.colName}</h3>
                <p className="text-slate-500 text-sm">ตัวแปรนี้ไม่ใช่ตัวเลข (Categorical Data) ไม่สามารถสร้างรายงาน Capability ได้</p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                    {Object.entries(varData.counts).slice(0,10).map(([k,v]) => (
                        <div key={k} className="flex justify-between items-center text-sm border-b border-slate-100 py-1">
                            <span className="text-slate-600 truncate">{k}</span>
                            <span className="font-bold text-indigo-600">{v}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const { lsl, usl, mean, std, cp, cpk, normality, distType } = varData;

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 border-b border-slate-100 pb-4">
                <h3 className="font-bold text-xl text-slate-800 text-indigo-900 flex items-center">
                    <Activity size={20} className="mr-2 text-indigo-500"/> {varData.colName}
                </h3>
                <div className="flex items-center space-x-3 mt-2 md:mt-0 text-sm">
                    <span className={`px-3 py-1.5 rounded-full font-bold shadow-sm border ${normality.isNormal ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        Normality: {normality.text} (p {normality.pVal})
                    </span>
                    <span className="bg-slate-50 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full font-semibold shadow-sm">Dist: {distType}</span>
                </div>
            </div>

            <div className="flex flex-col gap-6">
                <div ref={histRef} className="w-full h-[300px] md:h-[350px] relative border border-slate-100 rounded-lg p-4 bg-slate-50/50 shadow-sm"><canvas></canvas></div>
                <div ref={iChartRef} className="w-full h-[300px] md:h-[350px] relative border border-slate-100 rounded-lg p-4 bg-slate-50/50 shadow-sm"><canvas></canvas></div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
                    <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <div className="bg-slate-50 px-3 py-2.5 border-b border-slate-200 font-bold text-slate-700 text-xs text-center uppercase tracking-wider">Specifications</div>
                        <div className="grid grid-cols-2 text-sm bg-white h-full">
                            <div className="px-4 py-3 border-b border-r border-slate-100 text-slate-500 font-medium">LSL</div><div className="px-4 py-3 border-b border-slate-100 font-mono text-right font-semibold">{lsl||'-'}</div>
                            <div className="px-4 py-3 border-r border-slate-100 text-slate-500 font-medium">USL</div><div className="px-4 py-3 border-slate-100 font-mono text-right font-semibold">{usl||'-'}</div>
                        </div>
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                        <div className="bg-slate-50 px-3 py-2.5 border-b border-slate-200 font-bold text-slate-700 text-xs text-center uppercase tracking-wider">Performance</div>
                        <div className="grid grid-cols-2 text-sm bg-white h-full items-center">
                            <div className="px-4 py-2 border-b border-r border-slate-100 text-slate-500 font-medium">Mean</div><div className="px-4 py-2 border-b border-slate-100 font-mono text-right font-semibold">{mean.toFixed(4)}</div>
                            <div className="px-4 py-2 border-b border-r border-slate-100 text-slate-500 font-medium">StDev</div><div className="px-4 py-2 border-b border-slate-100 font-mono text-right font-semibold">{std.toFixed(4)}</div>
                            <div className="px-4 py-2 border-b border-r border-slate-100 text-slate-500 font-bold">Cp</div><div className="px-4 py-2 border-b border-slate-100 font-mono font-bold text-right text-indigo-600">{cp?.toFixed(2)||'-'}</div>
                            <div className="px-4 py-3 border-r border-slate-100 text-slate-500 font-bold text-base">Cpk</div><div className={`px-4 py-3 font-mono font-black text-right text-xl ${cpk !== null && cpk < 1.33 ? 'text-red-600' : 'text-emerald-600'}`}>{cpk?.toFixed(2)||'-'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const HypothesisTestDisplay = ({ result }) => {
    const { toolName, targetCol, groupCol, statResult } = result;

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
            <h3 className="font-bold text-xl text-slate-800 mb-4 border-b border-slate-100 pb-3">
                {toolName}: <span className="text-indigo-600">{targetCol}</span>
            </h3>
            <p className="text-sm text-slate-600 mb-6">วิเคราะห์ความแตกต่างของค่าเฉลี่ยแบ่งตาม: <span className="font-semibold">{groupCol}</span></p>
            
            <div className={`p-5 rounded-lg border-2 ${statResult.significant ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'} text-center`}>
                <div className="text-sm text-slate-500 uppercase tracking-wider mb-2 font-bold">สรุปผลการทดสอบทางสถิติ</div>
                {toolName === '2-Sample T-Test' ? (
                   <>
                     <div className="text-3xl font-black text-slate-800 mb-2">T-Value = {statResult.t}</div>
                     <div className={`text-lg font-bold ${statResult.significant ? 'text-indigo-600' : 'text-slate-500'}`}>
                        p-value {statResult.pValue} <br/>
                        {statResult.significant ? '(มีความแตกต่างกันอย่างมีนัยสำคัญ)' : '(ไม่มีความแตกต่างอย่างมีนัยสำคัญ)'}
                     </div>
                   </>
                ) : (
                   <>
                     <div className="text-3xl font-black text-slate-800 mb-2">F-Value = {statResult.f}</div>
                     <div className={`text-lg font-bold ${statResult.significant ? 'text-indigo-600' : 'text-slate-500'}`}>
                        p-value {statResult.pValue} <br/>
                        {statResult.significant ? '(มีความแตกต่างกันอย่างมีนัยสำคัญ)' : '(ไม่มีความแตกต่างอย่างมีนัยสำคัญ)'}
                     </div>
                   </>
                )}
            </div>
            <p className="text-xs text-slate-400 mt-4 text-center">* หมายเหตุ: ระบบประมวลผลการคำนวณทางสถิติเบื้องต้น (Approximation) บนเบราว์เซอร์ หากต้องการ Boxplot หรือความแม่นยำขั้นสูง กรุณา Export Data ไปยัง Minitab</p>
        </div>
    );
};


// --- Main Application Component ---
export default function DataPrepApp() {
  const [currentStep, setCurrentStep] = useState(1);
  const [activeView, setActiveView] = useState('pipeline'); 
  const [notification, setNotification] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // --- Multi-Model Setup (Product Models) ---
  const [modelsData, setModelsData] = useState(() => {
    const saved = localStorage.getItem('dataprep_models_stable_v3') || localStorage.getItem('dataprep_models_stable_v1'); 
    if (saved) {
        localStorage.setItem('dataprep_models_stable_v3', saved);
        return JSON.parse(saved);
    }
    
    const initialModels = [
      "X3082", "X3083", "X3439"
    ];
    
    const initialDict = {};
    initialModels.forEach(model => {
      const generalVars = TARGET_COLS.map(tc => ({ 
        id: generateId(), type: 'general', specId: '', process: '', originalName: tc, displayName: tc, unit: '', lsl: '', usl: '' 
      }));
      
      let specVars = [];
      if (model === "X3083") {
          specVars = X3083_PRESETS.map(sc => ({ id: generateId(), type: 'spec', ...sc }));
      } else {
          specVars = DEFAULT_SPEC_COLS.map(sc => ({ id: generateId(), type: 'spec', ...sc }));
      }
      
      initialDict[model] = [...generalVars, ...specVars];
    });
    
    return {
      models: initialModels,
      masterVarsDict: initialDict
    };
  });

  const [currentModel, setCurrentModel] = useState(modelsData.models[0]);
  const [activeMasterModel, setActiveMasterModel] = useState(modelsData.models[0]);

  // Derived state
  const activePipelineVars = modelsData.masterVarsDict[currentModel] || [];
  const activeMasterVars = modelsData.masterVarsDict[activeMasterModel] || [];

  // Data Pipeline States
  const [files, setFiles] = useState([]);
  const [mergedRawData, setMergedRawData] = useState([]);
  const [headerRowIdx, setHeaderRowIdx] = useState(1);
  
  // Step 3 Pre-Filter States
  const [removeBlankCols, setRemoveBlankCols] = useState(true);
  const [removeBlankRows, setRemoveBlankRows] = useState(true);
  const [excludeKeyword, setExcludeKeyword] = useState('');
  
  // Step 4 Advanced Imputation & Outlier Flagging
  const [dropCoreMissing, setDropCoreMissing] = useState(true);
  const [imputeMethod, setImputeMethod] = useState('none');
  const [fillMissingValue, setFillMissingValue] = useState('');
  const [outlierMethod, setOutlierMethod] = useState('spec'); 
  const [flagOutlier, setFlagOutlier] = useState(true);

  const [headers, setHeaders] = useState([]);
  const [structuredData, setStructuredData] = useState([]);
  const [selectedCols, setSelectedCols] = useState([]);
  const [cleanedData, setCleanedData] = useState([]);
  const [cleanedHeaders, setCleanedHeaders] = useState([]); 
  const [exportFileName, setExportFileName] = useState('cleaned_data');
  const [activeMasterTab, setActiveMasterTab] = useState('general'); 

  // History Backup
  const [history, setHistory] = useState(() => {
      const saved = localStorage.getItem('dataprep_history_stable_v3') || localStorage.getItem('dataprep_history_stable_v1');
      if (saved) {
          localStorage.setItem('dataprep_history_stable_v3', saved);
          return JSON.parse(saved);
      }
      return [];
  });
  const [selectedHistory, setSelectedHistory] = useState(null);
  
  const dataHistory = history.filter(h => h.type === 'data' && h.modelName === currentModel);
  const analysisHistory = history.filter(h => h.type === 'analysis_report' && h.modelName === currentModel);

  // --- Step 6 Analysis States ---
  const [analysisMode, setAnalysisMode] = useState('capability'); // 'capability', 'hypothesis'
  const [analysisToolHypo, setAnalysisToolHypo] = useState('ttest'); // 'ttest', 'anova'
  const [selectedAnalysisDatasets, setSelectedAnalysisDatasets] = useState([]); 
  const [selectedAnalysisVars, setSelectedAnalysisVars] = useState([]); // Multiple variables
  const [distType, setDistType] = useState('Normal'); // 'Normal', 'Weibull'
  const [specOverrides, setSpecOverrides] = useState({}); // { colName: {lsl, usl} }
  const [analysisFilterExcludeOutliers, setAnalysisFilterExcludeOutliers] = useState(false);
  const [analysisFilterTrimPercent, setAnalysisFilterTrimPercent] = useState(0);
  const [analysisReport, setAnalysisReport] = useState(null); // The final computed report
  const [hypoGroupingCol, setHypoGroupingCol] = useState('dataset_source'); // Target categorical col for Hypo test
  const [analysisTargetCol, setAnalysisTargetCol] = useState('');

  // Gemini AI States
  const [aiInsight, setAiInsight] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiCleanInsight, setAiCleanInsight] = useState(null);
  const [isAiCleanLoading, setIsAiCleanLoading] = useState(false);
  const [aiRcaInsight, setAiRcaInsight] = useState(null);
  const [isAiRcaLoading, setIsAiRcaLoading] = useState(false);

  const fileInputRef = useRef(null);
  const specFileInputRef = useRef(null);
  const directUploadRef = useRef(null);
  const chartRef = useRef(null);

  // Auto-select initial datasets when entering step 6
  useEffect(() => {
    if (currentStep === 6) {
       if (cleanedData.length > 0 && !selectedAnalysisDatasets.includes('current')) setSelectedAnalysisDatasets(['current']);
       else if (cleanedData.length === 0 && dataHistory.length > 0 && selectedAnalysisDatasets.length === 0) setSelectedAnalysisDatasets([dataHistory[0].id]);
    }
  // eslint-disable-next-line
  }, [currentStep, cleanedData.length, dataHistory.length]);

  const availableAnalysisHeaders = useMemo(() => {
    let headersSet = new Set();
    if (selectedAnalysisDatasets.includes('current') && cleanedHeaders.length > 0) cleanedHeaders.forEach(h => headersSet.add(h));
    dataHistory.forEach(h => {
      if (selectedAnalysisDatasets.includes(h.id)) h.headers.forEach(header => headersSet.add(header));
    });
    
    return Array.from(headersSet).filter(h => {
        if (h === 'Outlier_Status') return false;
        const masterVar = activePipelineVars.find(m => m.displayName === h || m.originalName === h);
        if (masterVar && masterVar.type === 'general') return false;
        return true; 
    });
  }, [selectedAnalysisDatasets, cleanedHeaders, dataHistory, activePipelineVars]);

  // Handle default spec overrides when variables are selected
  useEffect(() => {
      if (selectedAnalysisVars.length > 0) {
          const newOverrides = { ...specOverrides };
          let changed = false;
          selectedAnalysisVars.forEach(col => {
              if (!newOverrides[col]) {
                  const mv = activePipelineVars.find(m => m.displayName === col || m.originalName === col);
                  newOverrides[col] = { lsl: mv ? mv.lsl : '', usl: mv ? mv.usl : '' };
                  changed = true;
              }
          });
          if (changed) setSpecOverrides(newOverrides);
      }
  // eslint-disable-next-line
  }, [selectedAnalysisVars, activePipelineVars]);

  useEffect(() => {
    if (currentStep === 6 && availableAnalysisHeaders.length > 0) {
        if (!analysisTargetCol || !availableAnalysisHeaders.includes(analysisTargetCol)) setAnalysisTargetCol(availableAnalysisHeaders[0]);
    }
  }, [currentStep, availableAnalysisHeaders, analysisTargetCol]);

  useEffect(() => { localStorage.setItem('dataprep_models_stable_v3', JSON.stringify(modelsData)); }, [modelsData]);
  useEffect(() => { localStorage.setItem('dataprep_history_stable_v3', JSON.stringify(history)); }, [history]);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleModelChange = (newModel) => {
    if (files.length > 0 && !window.confirm('การเปลี่ยนโมเดลจะล้างไฟล์ที่กำลังอัปโหลดอยู่ คุณต้องการดำเนินการต่อหรือไม่?')) return;
    resetPipeline();
    setCurrentModel(newModel);
  };

  const createNewModel = () => {
    const newModel = window.prompt('ระบุชื่อโมเดลผลิตภัณฑ์ (Product Model) ใหม่:');
    if (newModel && newModel.trim() !== '') {
       if (modelsData.models.includes(newModel)) return showNotification('ชื่อโมเดลนี้มีอยู่แล้ว', 'error');
       setModelsData(prev => ({
         models: [...prev.models, newModel],
         masterVarsDict: {
           ...prev.masterVarsDict,
           [newModel]: TARGET_COLS.map(tc => ({ id: generateId(), type: 'general', specId: '', process: '', originalName: tc, displayName: tc, unit: '', lsl: '', usl: '' }))
         }
       }));
       handleModelChange(newModel);
       showNotification(`สร้างโมเดล ${newModel} สำเร็จ`);
    }
  };
  
  const deleteCurrentModel = () => {
    if (modelsData.models.length <= 1) return showNotification('ต้องมีอย่างน้อย 1 โมเดลในระบบ', 'error');
    if (window.confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบโมเดล "${activeMasterModel}"? (ประวัติและตัวแปรทั้งหมดของโมเดลนี้จะหายไป)`)) {
      setModelsData(prev => {
        const newModels = prev.models.filter(m => m !== activeMasterModel);
        const newDict = { ...prev.masterVarsDict };
        delete newDict[activeMasterModel];
        return { models: newModels, masterVarsDict: newDict };
      });
      const nextModel = modelsData.models.find(m => m !== activeMasterModel);
      setActiveMasterModel(nextModel);
      if (currentModel === activeMasterModel) handleModelChange(nextModel);
      showNotification('ลบโมเดลสำเร็จ');
    }
  };

  const updateMasterVar = (id, field, value) => {
    setModelsData(prev => {
       const updatedVars = prev.masterVarsDict[activeMasterModel].map(v => v.id === id ? { ...v, [field]: value } : v);
       return { ...prev, masterVarsDict: { ...prev.masterVarsDict, [activeMasterModel]: updatedVars } };
    });
  };
  
  const addMasterVar = (type) => {
    setModelsData(prev => {
       const newVar = { id: generateId(), type: type, specId: '', process: '', originalName: 'New_Col', displayName: 'New_Col', unit: '', lsl: '', usl: '' };
       const updatedVars = [...(prev.masterVarsDict[activeMasterModel] || []), newVar];
       return { ...prev, masterVarsDict: { ...prev.masterVarsDict, [activeMasterModel]: updatedVars } };
    });
  };

  const deleteMasterVar = (id) => {
    setModelsData(prev => {
       const updatedVars = prev.masterVarsDict[activeMasterModel].filter(v => v.id !== id);
       return { ...prev, masterVarsDict: { ...prev.masterVarsDict, [activeMasterModel]: updatedVars } };
    });
  };

  const handleExportMaster = () => {
     const currentVars = modelsData.masterVarsDict[activeMasterModel] || [];
     if (currentVars.length === 0) {
         showNotification('ไม่มีข้อมูล Master Variable ให้ Export', 'error');
         return;
     }
     exportMasterVars(currentVars, activeMasterModel);
  };

  const deleteHistoryItem = (id) => {
    if (window.confirm('คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลประวัตินี้?')) {
        setHistory(prev => prev.filter(h => h.id !== id));
        if (selectedHistory?.id === id) {
            setSelectedHistory(null);
            setActiveView('library');
        }
        showNotification('ลบข้อมูลสำเร็จ');
    }
  };

  const handleFileUpload = async (e) => {
    const uploadedFiles = Array.from(e.target.files);
    if (uploadedFiles.length === 0) return;

    let loadedCount = 0;
    const newFiles = [];

    for (const file of uploadedFiles) {
      const name = file.name.toLowerCase();
      const isCSV = name.endsWith('.csv');
      const isExcel = name.endsWith('.xlsx') || name.endsWith('.xls');

      if (!isCSV && !isExcel) {
        showNotification(`ไฟล์ ${file.name} ไม่รองรับ`, 'error');
        continue;
      }

      try {
        let rawData;
        if (isCSV) {
          rawData = await parseCSVRaw(file);
        } else {
          const arrayBuffer = await file.arrayBuffer();
          rawData = await parseExcelRaw(arrayBuffer);
        }
        newFiles.push({ id: generateId(), name: file.name, rawData });
        loadedCount++;
      } catch (err) {
        showNotification(`อ่านไฟล์ ${file.name} ไม่สำเร็จ`, 'error');
      }
    }

    if (loadedCount > 0) {
      setFiles(prev => [...prev, ...newFiles]);
      showNotification(`อัปโหลดสำเร็จ ${loadedCount} ไฟล์`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSpecUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isCSV = file.name.toLowerCase().endsWith('.csv');
    let rawData;
    try {
        if (isCSV) {
          rawData = await parseCSVRaw(file);
        } else {
          const arrayBuffer = await file.arrayBuffer();
          rawData = await parseExcelRaw(arrayBuffer);
        }
    } catch (err) {
        showNotification(`อ่านไฟล์ Spec ไม่สำเร็จ`, 'error');
        return;
    }

    let headerRowIdx = -1;
    let colMap = { specId: -1, process: -1, orig: -1, disp: -1, unit: -1, lsl: -1, usl: -1 };

    for (let i = 0; i < Math.min(rawData.length, 20); i++) {
      const row = rawData[i];
      const rowStr = row.join('').toLowerCase();
      if (rowStr.includes('original') || rowStr.includes('recording') || rowStr.includes('display') || rowStr.includes('ชื่อคอลัมน์')) {
        headerRowIdx = i;
        row.forEach((cell, idx) => {
          const c = String(cell).toLowerCase().trim();
          if (c === 'id' || c === 'รหัส') colMap.specId = idx;
          else if (c === 'process' || c === 'กระบวนการ') colMap.process = idx;
          else if (c.includes('original') || c.includes('recording') || c.includes('ชื่อคอลัมน์')) colMap.orig = idx;
          else if (c.includes('display') || c.includes('ชื่อที่ต้องการ')) colMap.disp = idx;
          else if (c.includes('unit') || c.includes('หน่วย')) colMap.unit = idx;
          else if (c.includes('lsl') || c.includes('lower')) colMap.lsl = idx;
          else if (c.includes('usl') || c.includes('upper')) colMap.usl = idx;
        });
        break;
      }
    }

    if (headerRowIdx === -1 || (colMap.orig === -1 && colMap.disp === -1)) {
      showNotification('ไม่พบรูปแบบคอลัมน์ Spec ที่ถูกต้อง (ต้องมี Recording/Original หรือ Display Name)', 'error');
      return;
    }

    const newSpecs = [];
    for (let i = headerRowIdx + 1; i < rawData.length; i++) {
      const row = rawData[i];
      
      const orig = colMap.orig !== -1 && row[colMap.orig] ? row[colMap.orig] : (colMap.disp !== -1 ? row[colMap.disp] : '');
      const disp = colMap.disp !== -1 && row[colMap.disp] ? row[colMap.disp] : orig;

      if (!orig || String(orig).trim() === '') continue;

      const generalKeywords = ["part id", "no.", "date", "time", "barcode", "errormessage", "error message", "result", "errorcode", "error code"];
      const isForceGeneral = generalKeywords.some(kw => String(orig).toLowerCase().includes(kw) || String(disp).toLowerCase().includes(kw));

      let lslVal = '';
      let uslVal = '';
      let unitVal = '';
      let varType = 'general';

      if (!isForceGeneral) {
         lslVal = colMap.lsl !== -1 && row[colMap.lsl] ? String(row[colMap.lsl]).trim() : '';
         uslVal = colMap.usl !== -1 && row[colMap.usl] ? String(row[colMap.usl]).trim() : '';
         unitVal = colMap.unit !== -1 && row[colMap.unit] ? String(row[colMap.unit]).trim() : '';
         varType = (lslVal !== '' || uslVal !== '') ? 'spec' : 'general';
      }

      newSpecs.push({
        id: generateId(),
        type: varType,
        specId: colMap.specId !== -1 && row[colMap.specId] ? String(row[colMap.specId]).trim() : '',
        process: colMap.process !== -1 && row[colMap.process] ? String(row[colMap.process]).trim() : '',
        originalName: String(orig).trim(),
        displayName: String(disp).trim(),
        unit: unitVal,
        lsl: lslVal,
        usl: uslVal
      });
    }

    if (newSpecs.length === 0) {
      showNotification('ไม่พบข้อมูล Spec ในไฟล์นี้', 'error');
      return;
    }

    setModelsData(prev => {
       const currentVars = prev.masterVarsDict[activeMasterModel] || [];
       const mergedVars = [...currentVars];
       
       newSpecs.forEach(newSpec => {
          const existingIdx = mergedVars.findIndex(v => v.originalName.toLowerCase() === newSpec.originalName.toLowerCase());
          if (existingIdx >= 0) {
             mergedVars[existingIdx] = { 
                 ...mergedVars[existingIdx], 
                 ...newSpec, 
                 id: mergedVars[existingIdx].id, 
                 type: newSpec.type 
             }; 
          } else {
             mergedVars.push(newSpec);
          }
       });
       return { ...prev, masterVarsDict: { ...prev.masterVarsDict, [activeMasterModel]: mergedVars } };
    });

    showNotification(`นำเข้าตัวแปรจำนวน ${newSpecs.length} รายการสำเร็จ`);
    if (specFileInputRef.current) specFileInputRef.current.value = '';
  };

  const handleDirectDataUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isCSV = file.name.toLowerCase().endsWith('.csv');
    let rawData;
    try {
        if (isCSV) {
          rawData = await parseCSVRaw(file);
        } else {
          const arrayBuffer = await file.arrayBuffer();
          rawData = await parseExcelRaw(arrayBuffer);
        }
    } catch (err) {
        showNotification(`อ่านไฟล์ไม่สำเร็จ กรุณาตรวจสอบไฟล์`, 'error');
        return;
    }

    if (rawData.length < 2) {
        showNotification('ข้อมูลไม่เพียงพอ (ต้องมีแถว Header อย่างน้อย 1 แถวและข้อมูล 1 แถว)', 'error');
        return;
    }

    // ดึง Header จากแถวแรก
    const headers = rawData[0].map(h => String(h).trim());
    const rows = [];
    
    // แปลงข้อมูลแถวต่อๆ มาให้อยู่ในรูปแบบ Object ตาม Header
    for (let i = 1; i < rawData.length; i++) {
        const rowArr = rawData[i];
        if (rowArr.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) continue;
        
        const rowObj = {};
        headers.forEach((h, idx) => {
            if (h) rowObj[h] = rowArr[idx] !== undefined ? String(rowArr[idx]).trim() : '';
        });
        rows.push(rowObj);
    }

    // สร้าง Record ลง History
    const record = {
      id: generateId(),
      type: 'data',
      modelName: currentModel,
      timestamp: new Date().toLocaleString('th-TH'),
      sourceFiles: `${file.name} (Direct Upload)`,
      headers: headers.filter(h => h),
      rows: rows,
      rowCount: rows.length
    };
    
    setHistory(prev => [record, ...prev]);
    showNotification(`อัปโหลดและนำเข้าข้อมูล ${rows.length} รายการลง Library สำเร็จ`);
    
    if (directUploadRef.current) directUploadRef.current.value = '';
  };

  const removeFile = (id) => setFiles(files.filter(f => f.id !== id));

  const autoDetectHeader = (data) => {
    if (!data || data.length === 0) return 0;
    const masterNames = activePipelineVars.map(v => v.originalName.toLowerCase());
    let bestIdx = 0;
    let maxMatch = 0;
    for (let i = 0; i < Math.min(data.length, 30); i++) {
        let matchCount = 0;
        data[i].forEach(cell => {
            if (cell && masterNames.includes(String(cell).toLowerCase().trim())) {
                matchCount++;
            }
        });
        if (matchCount > maxMatch) {
            maxMatch = matchCount;
            bestIdx = i;
        }
    }
    return bestIdx; 
  };

  const executeMerge = () => {
    if (files.length === 0) return;

    const masterVarNames = activePipelineVars.map(v => v.originalName.toLowerCase());
    let unifiedHeaders = [];
    let allAlignedRows = [];

    files.forEach(f => {
      if (!f.rawData || !Array.isArray(f.rawData) || f.rawData.length === 0) return;

      let headerIdx = autoDetectHeader(f.rawData);

      const fileHeaders = f.rawData[headerIdx].map(h => h ? String(h).trim() : '');
      const dataRows = f.rawData.slice(headerIdx + 1);

      fileHeaders.forEach(h => {
        if (h && !unifiedHeaders.includes(h)) {
          unifiedHeaders.push(h);
        }
      });

      dataRows.forEach(row => {
        if (row.every(cell => cell === undefined || cell === null || String(cell).trim() === '')) return;

        const alignedRow = new Array(unifiedHeaders.length).fill('');
        row.forEach((cell, colIdx) => {
          const headerName = fileHeaders[colIdx];
          if (headerName) {
            const targetIdx = unifiedHeaders.indexOf(headerName);
            if (targetIdx !== -1) {
              alignedRow[targetIdx] = cell !== undefined && cell !== null ? String(cell).trim() : '';
            }
          }
        });
        allAlignedRows.push(alignedRow);
      });
    });

    if (unifiedHeaders.length === 0) {
      let allRows = [];
      let maxCols = 0;
      files.forEach(f => {
        if (f.rawData && Array.isArray(f.rawData)) {
            f.rawData.forEach(row => {
              if (row.length > maxCols) maxCols = row.length;
              allRows.push(row);
            });
        }
      });
      allRows = allRows.map(row => {
        const padded = [...row];
        while(padded.length < maxCols) padded.push('');
        return padded;
      });
      setMergedRawData(allRows);
      setHeaderRowIdx(autoDetectHeader(allRows) + 1);
    } else {
      setMergedRawData([unifiedHeaders, ...allAlignedRows]);
      setHeaderRowIdx(1); 
    }

    setCurrentStep(3);
    showNotification('รวมไฟล์สำเร็จ (ตรวจพบและจัดเรียงคอลัมน์อัตโนมัติ 🚀)');
  };

  const previewHeaders = useMemo(() => {
    if (mergedRawData.length === 0) return [];
    const idx = Math.max(0, headerRowIdx - 1);
    if (idx >= mergedRawData.length) return [];

    const rawHeader = mergedRawData[idx] || [];
    const counts = {};
    const result = [];
    
    rawHeader.forEach((h, i) => {
      const rawStr = h ? String(h).trim() : '';
      if (removeBlankCols && !rawStr) {
         result.push({ original: '', display: '(ถูกตัดออก)', isMaster: false, isSkipped: true });
         return;
      }
      
      let name = rawStr || `Col_${i+1}`;
      if (counts[name]) {
        counts[name]++;
        name = `${name}_${counts[name]}`;
      } else {
        counts[name] = 1;
      }
      
      const mv = activePipelineVars.find(m => m.originalName.toLowerCase() === name.toLowerCase());
      result.push({
        original: name,
        display: mv ? mv.displayName : name,
        isMaster: !!mv,
        isSkipped: false
      });
    });
    
    return result;
  }, [mergedRawData, headerRowIdx, activePipelineVars, removeBlankCols]);

  const applyHeaderRow = () => {
    const idx = Math.max(0, headerRowIdx - 1);

    if (idx >= mergedRawData.length) {
      showNotification('หมายเลขแถว (Header) เกินจำนวนข้อมูล', 'error');
      return;
    }

    const rawHeader = mergedRawData[idx] || [];
    
    const uniqueHeaders = [];
    const validColIndices = [];
    const counts = {};
    
    rawHeader.forEach((h, i) => {
      const rawStr = h ? String(h).trim() : '';
      if (removeBlankCols && !rawStr) return; 
      
      let name = rawStr || `Col_${i+1}`;
      if (counts[name]) {
        counts[name]++;
        uniqueHeaders.push(`${name}_${counts[name]}`);
      } else {
        counts[name] = 1;
        uniqueHeaders.push(name);
      }
      validColIndices.push(i);
    });

    setHeaders(uniqueHeaders);
    
    let objRows = mergedRawData.slice(idx + 1).map(row => {
      const obj = {};
      validColIndices.forEach((cIdx, i) => {
        obj[uniqueHeaders[i]] = row[cIdx] !== undefined ? String(row[cIdx]).trim() : '';
      });
      return obj;
    });

    if (removeBlankRows) {
      objRows = objRows.filter(row => Object.values(row).some(val => val !== ''));
    }
    
    if (excludeKeyword) {
      const keywords = excludeKeyword.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
      if (keywords.length > 0) {
        objRows = objRows.filter(row => {
          return !Object.values(row).some(val => 
            keywords.some(kw => val.toLowerCase().includes(kw))
          );
        });
      }
    }

    setStructuredData(objRows);
    
    const masterNames = activePipelineVars.map(m => m.originalName.toLowerCase());
    const defaultSelected = uniqueHeaders.filter(h => masterNames.includes(h.toLowerCase()));
    
    setSelectedCols(defaultSelected); 
    setCurrentStep(4);
    showNotification(`ดึงข้อมูลสำเร็จ! เหลือข้อมูลจำนวน ${objRows.length} แถว`);
  };

  const toggleColumn = (col) => {
    setSelectedCols(prev => 
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const getDisplayName = (originalName) => {
    const v = activePipelineVars.find(m => m.originalName.toLowerCase() === originalName.toLowerCase());
    return v && v.displayName ? v.displayName : originalName;
  };

  const executeCleanData = () => {
    if (selectedCols.length === 0) {
      showNotification('กรุณาเลือกอย่างน้อย 1 ตัวแปร', 'error');
      return;
    }

    let finalHeaders = [];
    const aliasMap = {}; 
    const displayCounts = {};

    selectedCols.forEach(col => {
      const rawDisplay = getDisplayName(col);
      let finalDisplay = rawDisplay;
      
      if (displayCounts[finalDisplay]) {
        displayCounts[finalDisplay]++;
        finalDisplay = `${finalDisplay}_${displayCounts[finalDisplay]}`;
      } else {
        displayCounts[finalDisplay] = 1;
      }
      
      finalHeaders.push(finalDisplay);
      aliasMap[col] = finalDisplay;
    });

    let finalData = structuredData.map(row => {
      const newRow = {};
      selectedCols.forEach(col => {
        newRow[aliasMap[col]] = row[col];
      });
      return newRow;
    });

    if (dropCoreMissing) {
       const coreKeywords = ['part id', 'part_id', 'date', 'result', 'time'];
       const coreAliases = selectedCols
          .filter(c => coreKeywords.some(kw => c.toLowerCase().includes(kw)))
          .map(c => aliasMap[c]);
       
       finalData = finalData.filter(row => {
          let hasCore = true;
          for (const alias of coreAliases) {
             const val = row[alias];
             if (val === undefined || val === null || String(val).trim() === '') {
                 hasCore = false;
                 break;
             }
          }
          return hasCore;
       });
    }

    if (imputeMethod === 'median') {
       const medians = {};
       selectedCols.forEach(col => {
          const alias = aliasMap[col];
          const nums = finalData.map(r => parseFloat(r[alias])).filter(n => !isNaN(n)).sort((a,b)=>a-b);
          if (nums.length > 0) {
             const mid = Math.floor(nums.length / 2);
             medians[alias] = nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
          }
       });
       finalData.forEach(row => {
          selectedCols.forEach(col => {
             const alias = aliasMap[col];
             let val = row[alias];
             if (val === undefined || val === null || String(val).trim() === '') {
                 row[alias] = medians[alias] !== undefined ? String(medians[alias]) : '';
             }
          });
       });
    } else if (imputeMethod === 'ffill') {
       const lastValid = {};
       finalData.forEach(row => {
          selectedCols.forEach(col => {
             const alias = aliasMap[col];
             let val = row[alias];
             if (val === undefined || val === null || String(val).trim() === '') {
                 row[alias] = lastValid[alias] !== undefined ? lastValid[alias] : '';
             } else {
                 lastValid[alias] = val;
             }
          });
       });
    } else if (imputeMethod === 'custom' && fillMissingValue !== '') {
       finalData.forEach(row => {
          selectedCols.forEach(col => {
             const alias = aliasMap[col];
             let val = row[alias];
             if (val === undefined || val === null || String(val).trim() === '') {
                 row[alias] = fillMissingValue;
             }
          });
       });
    }

    let removedOutliersCount = 0;
    let flaggedOutliersCount = 0;

    if (outlierMethod !== 'none') {
       const initialRowCount = finalData.length;
       const colStats = {};

       selectedCols.forEach(col => {
          const alias = aliasMap[col];
          const nums = finalData.map(r => parseFloat(r[alias])).filter(n => !isNaN(n));
          if (nums.length === 0) return; 

          if (outlierMethod === 'iqr') {
             const sorted = [...nums].sort((a,b) => a-b);
             const q1 = sorted[Math.floor(sorted.length * 0.25)];
             const q3 = sorted[Math.floor(sorted.length * 0.75)];
             const iqr = q3 - q1;
             colStats[alias] = { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
          } else if (outlierMethod === 'zscore') {
             const mean = nums.reduce((a,b)=>a+b,0) / nums.length;
             const std = Math.sqrt(nums.reduce((a,b)=>a+Math.pow(b-mean,2),0)/nums.length) || 1;
             colStats[alias] = { lower: mean - 3 * std, upper: mean + 3 * std };
          } else if (outlierMethod === 'spec') {
             const masterInfo = activePipelineVars.find(m => m.originalName.toLowerCase() === col.toLowerCase()) || {};
             const lsl = parseFloat(masterInfo.lsl);
             const usl = parseFloat(masterInfo.usl);
             if (!isNaN(lsl) || !isNaN(usl)) {
                 colStats[alias] = {
                   lower: !isNaN(lsl) ? lsl : -Infinity,
                   upper: !isNaN(usl) ? usl : Infinity
                 };
             }
          }
       });

       if (flagOutlier) {
           finalHeaders.push('Outlier_Status');
       }

       finalData = finalData.filter(row => {
          let isOutlier = false;
          let failReasons = [];

          for (const col of selectedCols) {
             const alias = aliasMap[col];
             if (!colStats[alias]) continue;

             const val = parseFloat(row[alias]);
             if (!isNaN(val)) {
                 if (val < colStats[alias].lower) {
                    isOutlier = true;
                    failReasons.push(`${alias} (< LSL/Lower)`);
                 } else if (val > colStats[alias].upper) {
                    isOutlier = true;
                    failReasons.push(`${alias} (> USL/Upper)`);
                 }
             }
          }

          if (flagOutlier) {
              row['Outlier_Status'] = isOutlier ? `Fail: ${failReasons.join(', ')}` : 'Pass';
              if (isOutlier) flaggedOutliersCount++;
              return true; 
          } else {
              return !isOutlier; 
          }
       });

       if (!flagOutlier) {
          removedOutliersCount = initialRowCount - finalData.length;
       }
    }

    setCleanedHeaders(finalHeaders);
    setCleanedData(finalData);
    setAiRcaInsight(null);

    const record = {
      id: generateId(),
      type: 'data',
      modelName: currentModel,
      timestamp: new Date().toLocaleString('th-TH'),
      sourceFiles: files.map(f => f.name).join(', '),
      headers: finalHeaders,
      rows: finalData,
      rowCount: finalData.length
    };
    
    setHistory(prev => [record, ...prev]);
    
    const defaultName = files.length > 0 ? files[0].name.replace(/\.[^/.]+$/, "") + `_${currentModel}_cleaned` : "cleaned_data";
    setExportFileName(defaultName);
    
    setCurrentStep(5);
    setSelectedAnalysisDatasets(['current']);

    // --- 🚀 Garbage Collection ---
    setFiles([]);
    setMergedRawData([]);
    setStructuredData([]);

    let msg = `คลีนข้อมูลสำเร็จ!`;
    if (flagOutlier && flaggedOutliersCount > 0) msg += ` พบและ Flag Outlier ${flaggedOutliersCount.toLocaleString()} รายการ`;
    else if (!flagOutlier && removedOutliersCount > 0) msg += ` ลบ Outlier ทิ้ง ${removedOutliersCount.toLocaleString()} แถว`;
    
    msg += ` (ระบบล้างข้อมูลดิบในหน่วยความจำ RAM เรียบร้อย ⚡)`;
    showNotification(msg);
  };

  const totalSelectedRows = useMemo(() => {
    let count = 0;
    if (selectedAnalysisDatasets.includes('current')) count += cleanedData.length;
    dataHistory.forEach(h => {
       if (selectedAnalysisDatasets.includes(h.id)) count += h.rowCount;
    });
    return count;
  }, [selectedAnalysisDatasets, cleanedData.length, dataHistory]);

  // --- RUN ANALYSIS (STEP 6) ---
  const runAnalysis = () => {
    if (analysisMode === 'capability' && selectedAnalysisVars.length === 0) {
      showNotification('กรุณาเลือกตัวแปรที่จะนำมาวิเคราะห์อย่างน้อย 1 ตัวแปร', 'error');
      return;
    }
    if (analysisMode === 'hypothesis' && (!analysisTargetCol || !hypoGroupingCol)) {
      showNotification('กรุณาเลือกตัวแปรข้อมูล (Y) และตัวแปรจัดกลุ่ม (X)', 'error');
      return;
    }
    if (selectedAnalysisDatasets.length === 0) {
      showNotification('กรุณาเลือกข้อมูลอ้างอิงอย่างน้อย 1 ชุดข้อมูล', 'error');
      return;
    }

    const activeSources = [];
    if (selectedAnalysisDatasets.includes('current')) activeSources.push({ name: 'ข้อมูลปัจจุบัน', rows: cleanedData });
    dataHistory.forEach(h => {
      if (selectedAnalysisDatasets.includes(h.id)) activeSources.push({ name: `Backup (${h.timestamp.split(' ')[1]})`, rows: h.rows });
    });

    // ----------------------------------------------------
    // MODE 1: Capability Analysis & Normality (Multi-Variable)
    // ----------------------------------------------------
    if (analysisMode === 'capability') {
        const results = selectedAnalysisVars.map(col => {
            let allNums = [];
            let allVals = [];
            
            activeSources.forEach(source => {
                let filteredRows = source.rows;
                if (analysisFilterExcludeOutliers) {
                    filteredRows = filteredRows.filter(r => r['Outlier_Status'] === 'Pass' || !r['Outlier_Status']);
                }
                const vals = filteredRows.map(r => r[col]).filter(v => v !== undefined && v !== null && v !== '');
                let nums = vals.map(v => parseFloat(String(v).replace(/,/g, ''))).filter(n => !isNaN(n));
                
                if (analysisFilterTrimPercent > 0 && nums.length > 0) {
                    nums.sort((a,b) => a-b);
                    const trimCount = Math.floor(nums.length * (analysisFilterTrimPercent / 100));
                    if (trimCount * 2 < nums.length) nums = nums.slice(trimCount, nums.length - trimCount);
                }
                allVals = allVals.concat(vals);
                allNums = allNums.concat(nums);
            });

            const isNumeric = allNums.length > 0;
            if (!isNumeric) {
                const counts = {};
                allVals.forEach(v => { counts[v] = (counts[v]||0)+1; });
                return { colName: col, isNumeric: false, counts };
            }

            // Calculations
            const mean = statUtils.mean(allNums);
            const std = statUtils.stdDev(statUtils.variance(allNums, mean));
            const min = Math.min(...allNums);
            const max = Math.max(...allNums);
            
            // Spec Overrides Check
            let lsl = specOverrides[col]?.lsl;
            let usl = specOverrides[col]?.usl;
            if (lsl === undefined || lsl === null) {
                const mv = activePipelineVars.find(m => m.displayName === col || m.originalName === col);
                lsl = mv ? mv.lsl : '';
                usl = mv ? mv.usl : '';
            }

            const numLsl = parseFloat(lsl);
            const numUsl = parseFloat(usl);
            let cp = null, cpk = null;

            if (!isNaN(numLsl) && !isNaN(numUsl)) {
                cp = (numUsl - numLsl) / (6 * std);
                cpk = Math.min((numUsl - mean) / (3 * std), (mean - numLsl) / (3 * std));
            } else if (!isNaN(numLsl)) {
                cpk = (mean - numLsl) / (3 * std);
            } else if (!isNaN(numUsl)) {
                cpk = (numUsl - mean) / (3 * std);
            }

            // Normality & IMR
            const normality = statUtils.testNormality(allNums);
            const imr = statUtils.calculateIMR(allNums);

            return {
                colName: col, isNumeric: true, nums: allNums, mean, std, min, max, lsl, usl, cp, cpk, normality, imr, distType
            };
        });

        const report = {
            id: generateId(),
            type: 'analysis_report',
            mode: 'capability',
            modelName: currentModel,
            timestamp: new Date().toLocaleString('th-TH'),
            rowCount: totalSelectedRows,
            results
        };
        setAnalysisReport(report);
        setAiInsight(null);
        showNotification('สร้างรายงาน Capability Analysis (รวมทุกตัวแปร) สำเร็จ');
    } 
    // ----------------------------------------------------
    // MODE 2: Hypothesis Testing
    // ----------------------------------------------------
    else if (analysisMode === 'hypothesis') {
        let groups = {};
        
        activeSources.forEach(source => {
            let filteredRows = source.rows;
            if (analysisFilterExcludeOutliers) {
                filteredRows = filteredRows.filter(r => r['Outlier_Status'] === 'Pass' || !r['Outlier_Status']);
            }
            
            filteredRows.forEach(row => {
                const targetVal = parseFloat(String(row[analysisTargetCol]).replace(/,/g, ''));
                if (isNaN(targetVal)) return;

                // Determine Group Name
                let groupName = 'Unknown';
                if (hypoGroupingCol === 'dataset_source') groupName = source.name;
                else groupName = row[hypoGroupingCol] || 'Empty';

                if (!groups[groupName]) groups[groupName] = [];
                groups[groupName].push(targetVal);
            });
        });

        const groupNames = Object.keys(groups);
        if (groupNames.length < 2) {
             showNotification('ต้องมีข้อมูลอย่างน้อย 2 กลุ่ม (Groups) เพื่อเปรียบเทียบสมมติฐาน', 'error');
             return;
        }

        let statResult = {};
        if (analysisToolHypo === 'ttest' && groupNames.length >= 2) {
             // Take first two groups for T-Test
             statResult = statUtils.tTest(groups[groupNames[0]], groups[groupNames[1]]);
        } else if (analysisToolHypo === 'anova') {
             statResult = statUtils.anova(Object.values(groups));
        }

        const report = {
            id: generateId(),
            type: 'analysis_report',
            mode: 'hypothesis',
            toolName: analysisToolHypo === 'ttest' ? '2-Sample T-Test' : 'One-Way ANOVA',
            modelName: currentModel,
            timestamp: new Date().toLocaleString('th-TH'),
            rowCount: totalSelectedRows,
            targetCol: analysisTargetCol,
            groupCol: hypoGroupingCol,
            groups,
            statResult
        };

        setAnalysisReport(report);
        setAiInsight(null);
        showNotification(`วิเคราะห์ ${report.toolName} สำเร็จ`);
    }
  };

  const handleSaveAnalysisReport = () => {
    if (!analysisReport) return;
    setHistory(prev => [analysisReport, ...prev]);
    showNotification('บันทึกรายงานผลการวิเคราะห์ลง Library (คลังข้อมูล) เรียบร้อยแล้ว');
  };

  // --- Gemini API Functions ---
  const generateCleaningInsight = async () => {
    if (selectedCols.length === 0) return;
    setIsAiCleanLoading(true);
    setAiCleanInsight(null);

    const missingStats = selectedCols.map(col => {
      const missingCount = structuredData.filter(r => r[col] === undefined || r[col] === null || String(r[col]).trim() === '').length;
      const pct = ((missingCount / structuredData.length) * 100).toFixed(1);
      return `${col}: ${pct}%`;
    }).filter(stat => !stat.includes(' 0.0%')).join(', ') || 'ไม่มีค่าว่าง';

    const sampleData = structuredData.slice(0, 3).map(r => {
      const obj = {};
      selectedCols.forEach(c => obj[c] = r[c]);
      return JSON.stringify(obj);
    }).join('\n');

    const prompt = `คุณคือ Data Scientist ผู้เชี่ยวชาญด้านข้อมูลการผลิต
โปรดแนะนำวิธีการทำความสะอาดข้อมูล (Data Cleansing) สำหรับชุดข้อมูลนี้แบบสั้นๆ (3-4 บรรทัด) เป็นภาษาไทย
- โมเดล: ${currentModel}
- จำนวนข้อมูล: ${structuredData.length} แถว
- สัดส่วนค่าว่าง (Missing Values): ${missingStats}

ตัวอย่างข้อมูล (3 แถว):
${sampleData}

คำถาม:
1. ควรแทนที่ค่าว่างด้วยอะไร (เช่น 0, N/A, ค่าเฉลี่ย) หรือปล่อยผ่าน?
2. ควรจัดการ Outlier ด้วยวิธีใด (LSL/USL, IQR, Z-Score หรือ ไม่ต้องตัด) จึงจะเหมาะกับบริบทโรงงาน?`;

    try {
      const apiKey = "";
      const fetchGemini = async (text, retries = 5) => {
        const delays = [1000, 2000, 4000, 8000, 16000];
        for (let i = 0; i < retries; i++) {
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
              })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "ขออภัย ไม่สามารถสร้างผลการวิเคราะห์ได้";
          } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delays[i]));
          }
        }
      };

      const resultText = await fetchGemini(prompt);
      setAiCleanInsight(resultText);
    } catch (error) {
      showNotification('เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI', 'error');
    } finally {
      setIsAiCleanLoading(false);
    }
  };

  const generateRcaInsight = async () => {
    setIsAiRcaLoading(true);
    setAiRcaInsight(null);

    const failReasons = {};
    cleanedData.forEach(row => {
      const status = row['Outlier_Status'];
      if (status && status !== 'Pass') {
         failReasons[status] = (failReasons[status] || 0) + 1;
      }
    });

    const totalOutliers = Object.values(failReasons).reduce((a,b)=>a+b, 0);

    if (totalOutliers === 0) {
       setAiRcaInsight("วิเคราะห์เสร็จสิ้น: ไม่มีข้อมูลที่ผิดปกติ (Outlier) หรือหลุด Spec ในชุดข้อมูลนี้ กระบวนการผลิตอยู่ในสถานะที่ควบคุมได้ครับ");
       setIsAiRcaLoading(false);
       return;
    }

    const reasonText = Object.entries(failReasons)
        .sort((a,b) => b[1] - a[1]) // เรียงจากมากไปน้อย
        .map(([reason, count]) => `- ${reason}: ${count} รายการ`)
        .join('\n');

    const prompt = `คุณคือวิศวกรผู้เชี่ยวชาญด้านคุณภาพ (Quality Engineer) และ Root Cause Analysis (RCA) ในอุตสาหกรรมการผลิต
ข้อมูลการผลิตโมเดล ${currentModel} จำนวนทั้งหมด ${cleanedData.length} รายการ พบชิ้นงานที่ผิดปกติ (Outlier/หลุด Spec) จำนวน ${totalOutliers} รายการ แบ่งตามสาเหตุ (Failure Modes) ดังนี้:
${reasonText}

โปรดวิเคราะห์และให้คำแนะนำเป็นภาษาไทย (เน้นข้อความสำคัญด้วย **ตัวหนา**):
1. สาเหตุรากเหง้า (Root Cause) ที่เป็นไปได้ตามแนวคิด 4M1E (Man, Machine, Material, Method, Environment) โดยอิงจากชื่อตัวแปรที่ Fail (เช่น ตัวแปร RC/Current เกี่ยวกับกระแสไฟฟ้า, RPM/Speed เกี่ยวกับความเร็วรอบมอเตอร์)
2. แผนปฏิบัติการแก้ไขและป้องกัน (Corrective/Preventive Action Plan) ที่ควรตรวจสอบหน้างานทันที`;

    try {
      const apiKey = "";
      const fetchGemini = async (text, retries = 5) => {
        const delays = [1000, 2000, 4000, 8000, 16000];
        for (let i = 0; i < retries; i++) {
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
              })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "ขออภัย ไม่สามารถสร้างผลการวิเคราะห์ได้";
          } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delays[i]));
          }
        }
      };

      const resultText = await fetchGemini(prompt);
      setAiRcaInsight(resultText);
    } catch (error) {
      showNotification('เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI', 'error');
    } finally {
      setIsAiRcaLoading(false);
    }
  };

  const generateInsight = async () => {
    if (!analysisReport) return;
    setIsAiLoading(true);
    setAiInsight(null);

    let prompt = `คุณคือผู้เชี่ยวชาญด้านวิศวกรรมคุณภาพ (Quality Engineering) และการวิเคราะห์ข้อมูลอุตสาหกรรม (SPC)\nโปรดวิเคราะห์ข้อมูลสรุปต่อไปนี้และให้คำแนะนำที่เป็นประโยชน์ต่อการควบคุมคุณภาพ (เขียนเป็นภาษาไทย รูปแบบกระชับ มีการขึ้นบรรทัดใหม่เพื่อให้อ่านง่าย เน้นข้อความสำคัญ)\n\nโมเดลผลิตภัณฑ์: ${analysisReport.modelName}\nจำนวนข้อมูลทั้งหมด: ${analysisReport.rowCount} รายการ\n`;

    if (analysisReport.mode === 'capability') {
        prompt += `\nประเภทการวิเคราะห์: Capability Analysis (แจกแจงแบบ ${analysisReport.results[0]?.distType || 'Normal'})\n`;
        analysisReport.results.forEach(r => {
            if (r.isNumeric) {
               prompt += `\nตัวแปร [${r.colName}]: \n- Cpk: ${r.cpk ? r.cpk.toFixed(2) : 'N/A'}, Cp: ${r.cp ? r.cp.toFixed(2) : 'N/A'} \n- P-Value (Normality): ${r.normality.pVal} \n- ค่าเฉลี่ย: ${r.mean.toFixed(3)}, SD: ${r.std.toFixed(3)} \n- Spec: [${r.lsl || 'ไม่มี'}, ${r.usl || 'ไม่มี'}]\n`;
            }
        });
        prompt += `\nคำสั่ง: สรุปเสถียรภาพโดยรวมของทุกตัวแปร ระบุความผิดปกติหรือความเสี่ยงที่อาจเกิดขึ้น (อธิบายความหมายของ Cpk และ Normality) และให้คำแนะนำทางวิศวกรรมต่อไป`;
    } else {
        prompt += `\nประเภทการวิเคราะห์: ${analysisReport.toolName}\nเปรียบเทียบตัวแปร: ${analysisReport.targetCol} โดยแบ่งตามกลุ่ม ${analysisReport.groupCol}\n`;
        prompt += `ผลสถิติ: ค่าสถิติทดสอบ=${analysisReport.statResult.t || analysisReport.statResult.f}, P-Value=${analysisReport.statResult.pValue}\n`;
        prompt += `\nคำสั่ง: สรุปผลการทดสอบสมมติฐานนี้ ว่ากลุ่มตัวอย่างมีความแตกต่างกันอย่างมีนัยสำคัญหรือไม่ และความแตกต่างนี้บ่งบอกถึงอะไรในกระบวนการผลิต`;
    }

    try {
      const apiKey = "";
      const fetchGemini = async (text, retries = 5) => {
        const delays = [1000, 2000, 4000, 8000, 16000];
        for (let i = 0; i < retries; i++) {
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
              })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "ขออภัย ไม่สามารถสร้างผลการวิเคราะห์ได้";
          } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delays[i]));
          }
        }
      };

      const resultText = await fetchGemini(prompt);
      setAiInsight(resultText);
    } catch (error) {
      showNotification('เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI', 'error');
    } finally {
      setIsAiLoading(false);
    }
  };

  const resetPipeline = () => {
    setFiles([]); setMergedRawData([]); 
    setHeaders([]); setStructuredData([]); setSelectedCols([]);
    setCleanedData([]); setExportFileName('cleaned_data'); 
    setAnalysisReport(null);
    setAiInsight(null);
    setAiCleanInsight(null);
    setAiRcaInsight(null);
    setSelectedAnalysisDatasets([]);
    setOutlierMethod('spec');
    setImputeMethod('none');
    setAnalysisFilterExcludeOutliers(false);
    setAnalysisFilterTrimPercent(0);
    setCurrentStep(1); setActiveView('pipeline');
  };

  // --- View Renders ---

  const renderMasterView = () => {
    const displayedVars = activeMasterVars.filter(v => v.type === activeMasterTab);
    return (
      <div className="animate-in fade-in h-full flex flex-col bg-slate-50/50 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm p-4 md:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 md:mb-8 gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-extrabold text-slate-800 flex items-center">
              <Settings className="mr-2 md:mr-3 text-indigo-600" size={28} /> Settings & Variables
            </h2>
            <div className="flex items-center mt-1 md:mt-2 text-sm md:text-base font-medium">
               <span className="text-slate-500">จัดการโมเดลและข้อกำหนดสเปค (LSL/USL)</span>
               <span className="ml-4 flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shadow-sm">
                   <CheckCircle2 size={12} className="mr-1"/> บันทึกอัตโนมัติ (Auto-saved)
               </span>
            </div>
          </div>
          <button onClick={() => setActiveView('pipeline')} className="w-full md:w-auto px-6 py-2.5 bg-white border-2 border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 font-bold transition-all shadow-sm">
            กลับหน้าหลัก
          </button>
        </div>

        {/* Model Config Box */}
        <div className="bg-white border border-stone-200 p-4 md:p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between shadow-sm mb-6 gap-4">
           <div className="flex items-center w-full md:w-auto">
             <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center mr-3 md:mr-4 shrink-0"><Box size={20}/></div>
             <div className="flex-1">
               <label className="text-[10px] md:text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">โมเดลที่กำลังแก้ไข</label>
               <select value={activeMasterModel} onChange={e => setActiveMasterModel(e.target.value)} className="w-full md:w-64 border-0 text-lg md:text-xl font-black text-indigo-900 bg-transparent focus:ring-0 cursor-pointer p-0">
                  {modelsData.models.map(m => <option key={m} value={m}>{m}</option>)}
               </select>
             </div>
           </div>
           <div className="flex items-center gap-2 w-full md:w-auto">
             <button onClick={createNewModel} className="flex-1 md:flex-none px-3 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-bold transition-colors text-sm flex items-center justify-center whitespace-nowrap">
               <Plus size={16} className="mr-1.5" /> สร้างโมเดล
             </button>
             <button onClick={deleteCurrentModel} className="flex-1 md:flex-none px-3 py-2 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg font-bold transition-colors text-sm flex items-center justify-center whitespace-nowrap">
               <Trash2 size={16} className="mr-1.5" /> ลบโมเดล
             </button>
           </div>
        </div>

        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-4 gap-4">
            <div className="flex space-x-2 bg-slate-200/50 p-1 rounded-xl w-full xl:w-auto overflow-x-auto">
            <button onClick={() => setActiveMasterTab('general')} className={`flex-1 xl:flex-none px-4 md:px-6 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap ${activeMasterTab === 'general' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>
                General Vars
            </button>
            <button onClick={() => setActiveMasterTab('spec')} className={`flex-1 xl:flex-none px-4 md:px-6 py-2.5 text-sm font-bold rounded-lg transition-all whitespace-nowrap ${activeMasterTab === 'spec' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>
                Spec Vars
            </button>
            </div>
            <div className="flex gap-2 w-full xl:w-auto">
                <button onClick={handleExportMaster} className="flex-1 xl:flex-none px-4 py-2.5 bg-slate-800 text-white rounded-xl hover:bg-slate-900 font-bold transition-all shadow-sm text-sm flex items-center justify-center whitespace-nowrap">
                    <Download size={16} className="mr-2" /> Export CSV
                </button>
                <input type="file" accept=".csv, .xlsx, .xls" className="hidden" ref={specFileInputRef} onChange={handleSpecUpload} />
                <button onClick={() => specFileInputRef.current?.click()} className="flex-1 xl:flex-none px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 font-bold transition-all shadow-sm text-sm flex items-center justify-center whitespace-nowrap">
                    <Upload size={16} className="mr-2" /> Import CSV/Excel
                </button>
                <button onClick={() => addMasterVar(activeMasterTab)} className="flex-1 xl:flex-none px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-bold transition-all shadow-sm text-sm flex items-center justify-center whitespace-nowrap">
                    <Plus size={16} className="mr-2" /> เพิ่มแถว
                </button>
            </div>
        </div>

        <div className="flex-grow overflow-x-auto bg-white rounded-2xl border border-stone-200 shadow-sm">
          {displayedVars.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-400 p-8 text-center min-h-[300px]">
              <CheckSquare size={48} className="mb-4 opacity-50"/>
              <p className="font-bold text-lg text-slate-500">ไม่มีข้อมูลตัวแปรประเภทนี้</p>
              <p className="text-sm mt-2 max-w-sm">กดปุ่ม <b>นำเข้า Spec</b> เพื่ออัปโหลดไฟล์ LSL/USL</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left min-w-[800px]">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur z-10 border-b border-slate-200">
                {activeMasterTab === 'general' ? (
                  <tr>
                    <th className="px-6 py-4 text-slate-600 font-bold w-1/2">Original Name (ชื่อในไฟล์)</th>
                    <th className="px-6 py-4 text-indigo-700 font-extrabold w-1/2 border-l border-slate-200/50">Display Name (ชื่อแสดงผล)</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="px-3 py-3 text-slate-600 font-bold whitespace-nowrap w-24">ID</th>
                    <th className="px-3 py-3 text-slate-600 font-bold whitespace-nowrap w-32">Process</th>
                    <th className="px-3 py-3 text-slate-600 font-bold w-48">Original Name</th>
                    <th className="px-3 py-3 text-indigo-700 font-extrabold border-x border-slate-200/50 w-40">Display Name</th>
                    <th className="px-3 py-3 text-slate-600 font-bold w-20 text-center">Unit</th>
                    <th className="px-3 py-3 text-slate-600 font-bold w-24 text-center">LSL</th>
                    <th className="px-3 py-3 text-slate-600 font-bold w-24 text-center">USL</th>
                    <th className="px-3 py-3 text-center w-16">Del</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedVars.map((v) => (
                  <tr key={v.id} className="hover:bg-indigo-50/30 transition-colors group">
                    {activeMasterTab === 'spec' && (
                      <>
                        <td className="px-2 py-2"><input type="text" value={v.specId || ''} onChange={(e) => updateMasterVar(v.id, 'specId', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all" placeholder="-" /></td>
                        <td className="px-2 py-2"><input type="text" value={v.process || ''} onChange={(e) => updateMasterVar(v.id, 'process', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all" placeholder="-" /></td>
                      </>
                    )}
                    <td className="px-2 py-2"><input type="text" value={v.originalName} onChange={(e) => updateMasterVar(v.id, 'originalName', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all font-medium text-slate-700" placeholder="Column Name" /></td>
                    <td className={`px-2 py-2 bg-indigo-50/20 ${activeMasterTab === 'spec' ? 'border-x border-slate-100' : 'border-l border-slate-100'}`}><input type="text" value={v.displayName} onChange={(e) => updateMasterVar(v.id, 'displayName', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-transparent font-bold text-indigo-800 hover:border-indigo-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all" placeholder="Alias Name" /></td>
                    
                    {activeMasterTab === 'spec' && (
                      <>
                        <td className="px-2 py-2"><input type="text" value={v.unit || ''} onChange={(e) => updateMasterVar(v.id, 'unit', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-transparent hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all text-center" placeholder="-" /></td>
                        <td className="px-2 py-2"><input type="number" value={v.lsl} onChange={(e) => updateMasterVar(v.id, 'lsl', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all font-mono text-center" placeholder="N/A" /></td>
                        <td className="px-2 py-2"><input type="number" value={v.usl} onChange={(e) => updateMasterVar(v.id, 'usl', e.target.value)} className="w-full px-2 py-1.5 bg-transparent border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-lg outline-none transition-all font-mono text-center" placeholder="N/A" /></td>
                      </>
                    )}
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => deleteMasterVar(v.id)} className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  const renderLibraryDashboard = () => {
     // กรองรายงานประเภทใหม่ (analysis_report)
     const allData = history.filter(h => h.type === 'data');
     const allAnalysis = history.filter(h => h.type === 'analysis_report');

     return (
       <div className="animate-in fade-in h-full flex flex-col">
         <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                <FolderOpen className="mr-2 text-indigo-600" size={28} /> คลังข้อมูล (Data Library)
              </h2>
              <p className="text-slate-500 mt-1 text-sm">จัดการข้อมูลประวัติทั้งหมด (Cleaned Data และ Analysis Reports)</p>
            </div>
            <div className="flex space-x-3">
              <input type="file" accept=".csv, .xlsx, .xls" className="hidden" ref={directUploadRef} onChange={handleDirectDataUpload} />
              <button onClick={() => directUploadRef.current?.click()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors text-sm shadow-sm flex items-center">
                 <Upload size={16} className="mr-2" /> อัปโหลดข้อมูล (Direct)
              </button>
              <button onClick={() => setActiveView('pipeline')} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors text-sm shadow-sm">
                กลับไปหน้าหลัก
              </button>
            </div>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-grow min-h-0">
            {/* Cleaned Data Column */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
               <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-slate-700 flex items-center"><Database size={16} className="mr-2 text-emerald-500"/> Cleaned Data Backup</h3>
                  <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-full font-bold">{allData.length}</span>
               </div>
               <div className="overflow-y-auto flex-grow p-2">
                 {allData.length === 0 ? <p className="text-center text-slate-400 mt-10 text-sm">ยังไม่มีข้อมูล</p> : (
                    <div className="space-y-2">
                      {allData.map(h => (
                         <div key={h.id} className="p-3 border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                               <div>
                                 <p className="text-sm font-bold text-indigo-800">{h.modelName} <span className="text-xs font-normal text-slate-500 ml-2">{h.timestamp}</span></p>
                                 <p className="text-xs text-slate-500 mt-0.5">{h.rowCount.toLocaleString()} แถว • ต้นฉบับ: <span className="truncate max-w-[150px] inline-block align-bottom">{h.sourceFiles}</span></p>
                               </div>
                               <button onClick={() => deleteHistoryItem(h.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                            </div>
                            <div className="flex gap-2">
                               <button onClick={() => { setSelectedHistory(h); setActiveView('history_view'); }} className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded flex items-center font-medium">
                                 <BookOpen size={12} className="mr-1.5"/> ดูข้อมูล
                               </button>
                               <button onClick={() => exportToExcel(h.headers, h.rows, `backup_${h.modelName}_${h.id}.xlsx`)} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded flex items-center font-medium">
                                 <Download size={12} className="mr-1.5"/> โหลด Excel
                               </button>
                            </div>
                         </div>
                      ))}
                    </div>
                 )}
               </div>
            </div>

            {/* Analysis Report Column */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
               <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-slate-700 flex items-center"><BarChart2 size={16} className="mr-2 text-indigo-500"/> Analysis Reports (V3)</h3>
                  <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full font-bold">{allAnalysis.length}</span>
               </div>
               <div className="overflow-y-auto flex-grow p-2">
                 {allAnalysis.length === 0 ? <p className="text-center text-slate-400 mt-10 text-sm">ยังไม่มีรายงานกราฟ</p> : (
                    <div className="space-y-2">
                      {allAnalysis.map(h => (
                         <div key={h.id} className="p-3 border border-slate-100 rounded-lg hover:bg-slate-50 transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                               <div>
                                 <p className="text-sm font-bold text-indigo-800">{h.mode === 'capability' ? 'Capability Analysis' : h.toolName}</p>
                                 <p className="text-xs text-slate-600 mt-0.5">โมเดล: <span className="font-bold">{h.modelName}</span></p>
                                 <p className="text-xs text-slate-400 mt-0.5">{h.timestamp} • วิเคราะห์จากข้อมูล {h.rowCount} แถว</p>
                               </div>
                               <button onClick={() => deleteHistoryItem(h.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button>
                            </div>
                            <div className="flex gap-2">
                               <button onClick={() => { setAnalysisReport(h); setActiveView('history_view'); }} className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded flex items-center font-medium w-full justify-center">
                                 <BarChart2 size={12} className="mr-1.5"/> เปิดดู Report Dashboard
                               </button>
                            </div>
                         </div>
                      ))}
                    </div>
                 )}
               </div>
            </div>
         </div>
       </div>
     );
  };

  const renderHistoryView = () => {
    // History View ของ Analysis แบบใหม่
    if (analysisReport && activeView === 'history_view') {
        return (
            <div className="animate-in fade-in h-full flex flex-col">
              <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                    <BarChart2 className="mr-2 text-indigo-600" size={28} /> Saved Report Dashboard
                  </h2>
                  <p className="text-slate-500 mt-1 pl-10 text-sm">บันทึกเมื่อ: {analysisReport.timestamp}</p>
                </div>
                <div className="flex space-x-3">
                   <button onClick={() => { setAnalysisReport(null); setActiveView('library'); }} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors text-sm">กลับคลังข้อมูล</button>
                </div>
              </div>

              <div className="flex-grow overflow-auto custom-scrollbar">
                  {analysisReport.mode === 'capability' ? (
                      analysisReport.results.map((res, i) => <VariableReportCard key={i} varData={res} />)
                  ) : (
                      <HypothesisTestDisplay result={analysisReport} />
                  )}
              </div>
            </div>
        );
    }

    if (!selectedHistory) return null;
    
    // History View ของข้อมูลดิบ (Data)
    return (
      <div className="animate-in fade-in h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center">
              <History className="mr-2 text-indigo-600" size={24} /> ข้อมูลสำรอง (Cleaned Data)
            </h2>
            <p className="text-slate-500 mt-1">บันทึกเมื่อ: {selectedHistory.timestamp} (โมเดล: {selectedHistory.modelName})</p>
          </div>
          <div className="flex space-x-3">
             <button onClick={() => setActiveView('library')} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors text-sm">กลับคลังข้อมูล</button>
            <button onClick={() => exportToCSV(selectedHistory.headers, selectedHistory.rows, `backup_${selectedHistory.modelName}_${selectedHistory.id}.csv`)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm text-sm flex items-center">
              <Download size={16} className="mr-2" /> โหลด CSV
            </button>
            <button onClick={() => exportToExcel(selectedHistory.headers, selectedHistory.rows, `backup_${selectedHistory.modelName}_${selectedHistory.id}.xlsx`)} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors shadow-sm text-sm flex items-center">
              <FileSpreadsheet size={16} className="mr-2" /> โหลด Excel
            </button>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-4">
          <p className="text-sm text-slate-600"><span className="font-semibold">ไฟล์ต้นฉบับ:</span> {selectedHistory.sourceFiles}</p>
          <p className="text-sm text-slate-600 mt-1"><span className="font-semibold">จำนวนข้อมูล:</span> {selectedHistory.rowCount.toLocaleString()} แถว • {selectedHistory.headers.length} ตัวแปร</p>
        </div>

        <div className="flex-grow overflow-auto bg-white rounded-xl border border-slate-200 shadow-sm relative">
            <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="sticky top-0 bg-slate-100 z-10 shadow-sm">
              <tr>
                {selectedHistory.headers.map((h, i) => <th key={i} className="px-4 py-3 border-b border-slate-200 text-slate-700 font-bold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {selectedHistory.rows.slice(0, 100).map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors border-b border-slate-50">
                  {selectedHistory.headers.map((h, i) => <td key={`${idx}-${i}`} className="px-4 py-2 text-slate-600 truncate max-w-[250px]">{row[h] || ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderPipelineStep = () => {
    switch(currentStep) {
      case 1:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 mb-8 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm">
               <div>
                  <h3 className="text-base font-bold text-indigo-900 mb-1 flex items-center">
                    <Box size={18} className="mr-2" /> เลือกรุ่นสินค้า (Product Model)
                  </h3>
                  <p className="text-sm text-indigo-700/80">ระบบจะดึงการตั้งค่าตัวแปรและ Spec ของโมเดลนี้มาใช้โดยอัตโนมัติ</p>
               </div>
               <div className="flex items-center space-x-3 mt-4 sm:mt-0">
                  <select
                    value={currentModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="border border-indigo-300 rounded-lg px-4 py-2 w-64 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-bold text-indigo-800 bg-white shadow-sm"
                  >
                    {modelsData.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button
                    onClick={createNewModel}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center shadow-sm"
                  >
                    <Plus size={16} className="mr-1" /> สร้าง
                  </button>
               </div>
            </div>

            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-bold text-slate-800 mb-1">1. อัปโหลดไฟล์ข้อมูลดิบ</h2>
                <p className="text-sm text-slate-500">รองรับไฟล์ .csv, .xlsx หรือ .xls สามารถเลือกอัปโหลดหลายไฟล์พร้อมกันได้</p>
              </div>
              <div className="flex space-x-3 shrink-0 ml-4">
                <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors shadow-sm flex items-center text-sm">
                  <Upload size={16} className="mr-2" /> อัปโหลดไฟล์
                </button>
                <button onClick={() => setCurrentStep(2)} disabled={files.length === 0} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center transition-colors ${files.length > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                  ขั้นตอนต่อไป <ArrowRight size={16} className="ml-2" />
                </button>
              </div>
            </div>
            
            <input type="file" accept=".csv, .xlsx, .xls" multiple className="hidden" ref={fileInputRef} onChange={handleFileUpload} />

            {files.length === 0 ? (
              <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-300 bg-white rounded-xl p-12 text-center hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors cursor-pointer mb-6">
                <Upload size={40} className="mx-auto text-slate-400 mb-4" />
                <p className="text-lg font-medium text-slate-700">คลิกหรือลากไฟล์มาวางที่นี่</p>
                <p className="text-sm text-slate-500 mt-1">อัปโหลดไฟล์หลายๆ ไฟล์เพื่อรวมตารางได้</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 font-semibold text-slate-700 flex justify-between">
                  <span>ไฟล์ที่เตรียมไว้ ({files.length})</span>
                </div>
                <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                  {files.map(f => (
                    <li key={f.id} className="px-4 py-3 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center"><FileText size={18} className="text-slate-400 mr-3" /><span className="text-sm font-medium text-slate-700">{f.name}</span></div>
                      <button onClick={() => removeFile(f.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );

      case 2:
        return (
          <div className="animate-in fade-in slide-in-from-right-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-2">2. รวมไฟล์ข้อมูล (Smart Merge)</h2>
            <p className="text-slate-500 mb-6">ระบบจะนำข้อมูลจากทุกไฟล์มาเรียงต่อกันในแนวตั้ง พร้อมตรวจจับคอลัมน์ให้อัตโนมัติ</p>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6 text-center">
              <Layers size={48} className="mx-auto text-indigo-200 mb-4" />
              <h3 className="text-lg font-semibold text-slate-700 mb-2">ไฟล์ที่พร้อมรวม: {files.length} ไฟล์</h3>
              <p className="text-sm text-slate-500 mb-6 max-w-md mx-auto">{files.map(f => f.name).join(', ')}</p>
              <button onClick={executeMerge} className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm inline-flex items-center">
                <Sparkles size={18} className="mr-2" /> เริ่มทำการนำข้อมูลมาต่อกัน
              </button>
            </div>
            <div className="flex justify-between"><button onClick={() => setCurrentStep(1)} className="px-6 py-3 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors">ย้อนกลับ</button></div>
          </div>
        );

      case 3:
        return (
          <div className="animate-in fade-in slide-in-from-right-8 h-full flex flex-col">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">3. กำหนดหัวตัวแปร และ การกรองข้อมูล</h2>
              <p className="text-slate-500 mb-4 flex items-center">
                 ระบบค้นหาและจับคู่หัวตารางอัตโนมัติอ้างอิงจาก Master Variables หากมีข้อผิดพลาดสามารถแก้ไขได้
              </p>
              
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm mb-6 space-y-4">
                <div className="flex flex-wrap items-end gap-4 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                  <div>
                    <label className="block text-xs font-bold text-indigo-900 mb-1 uppercase tracking-wider">Row: Header *</label>
                    <input type="number" min="1" max={mergedRawData.length} value={headerRowIdx} onChange={(e) => setHeaderRowIdx(parseInt(e.target.value) || 1)} className="w-24 border border-indigo-300 bg-white rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none font-bold" />
                  </div>
                  <div className="text-xs font-medium text-indigo-700 mb-2">
                     <CheckCircle2 size={14} className="inline mr-1"/> ระบบจัดวางหัวตารางให้ตรงกันไว้ที่แถวนี้อัตโนมัติแล้ว
                  </div>
                  <div className="flex-grow"></div>
                  <button onClick={applyHeaderRow} className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center h-[42px] shadow-sm">
                    <Check size={18} className="mr-2" /> ยืนยันและสกัดข้อมูล
                  </button>
                </div>
                
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider flex items-center">
                    <Filter size={14} className="mr-1.5 text-indigo-500" /> ตัวกรองก่อนนำเข้า (Pre-filter)
                  </h3>
                  <div className="flex flex-wrap items-center gap-6">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input type="checkbox" checked={removeBlankCols} onChange={e => setRemoveBlankCols(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-300" />
                      <span className="text-sm text-slate-700 font-medium">ตัดตัวแปร (คอลัมน์) ที่ไม่มีชื่อ</span>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input type="checkbox" checked={removeBlankRows} onChange={e => setRemoveBlankRows(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-300" />
                      <span className="text-sm text-slate-700 font-medium">ตัดแถวที่ว่างเปล่าทั้งหมด</span>
                    </label>
                    <div className="flex items-center space-x-2 flex-grow max-w-sm">
                      <span className="text-sm text-slate-700 font-medium whitespace-nowrap">ตัดแถวที่มีคำว่า:</span>
                      <input type="text" placeholder="เช่น N/A, Error (คั่นด้วยลูกน้ำ)" value={excludeKeyword} onChange={e => setExcludeKeyword(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-grow overflow-auto bg-white rounded-xl border border-slate-200 shadow-sm relative">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="sticky top-0 bg-slate-100 z-10 shadow-sm">
                  <tr>
                    <th className="px-3 py-2 w-12 text-center text-slate-400 border-b border-slate-200">Row</th>
                    {previewHeaders.length > 0 ? previewHeaders.slice(0, 20).map((h, i) => (
                      <th key={i} className={`px-4 py-2 border-b border-slate-200 font-medium max-w-[200px] truncate ${h.isSkipped ? 'text-red-400 bg-red-50/50 line-through' : h.isMaster ? 'text-indigo-700 font-bold bg-indigo-50/50' : 'text-slate-500'}`} title={`ต้นฉบับ: ${h.original}`}>
                        {h.isSkipped ? '(ตัดทิ้ง)' : h.display}
                      </th>
                    )) : Array.from({ length: 5 }).map((_, i) => (
                      <th key={i} className="px-4 py-2 border-b border-slate-200 text-slate-500 font-medium">Col {i+1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mergedRawData.slice(0, 100).map((row, idx) => {
                    const rNum = idx + 1;
                    const isHeader = rNum === headerRowIdx;
                    
                    let bgClass = 'hover:bg-slate-50 text-slate-600';
                    if (isHeader) bgClass = 'bg-emerald-100/60 font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-400';

                    return (
                      <tr key={idx} className={bgClass}>
                        <td className="px-3 py-2 text-center border-r border-slate-100 text-slate-400 bg-slate-50/50">
                          {isHeader ? 'H' : rNum}
                        </td>
                        {row.slice(0, 20).map((cell, cIdx) => {
                          const isSkipped = previewHeaders[cIdx]?.isSkipped;
                          return (
                            <td key={cIdx} className={`px-4 py-2 max-w-[200px] truncate border-r border-slate-50 ${isSkipped ? 'bg-red-50/30 text-red-300 line-through' : ''}`}>
                              {cell || <span className="text-slate-300 italic">ว่าง</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2 text-right">แสดงตัวอย่าง 100 แถวแรก (คอลัมน์ที่ถูกตัดออกจะขีดฆ่าด้วยสีแดง)</p>
          </div>
        );

      case 4:
        return (
          <div className="animate-in fade-in slide-in-from-right-8 h-full flex flex-col">
            <div>
              <div className="flex justify-between items-center mb-2">
                <h2 className="text-2xl font-bold text-slate-800">4. จัดการตัวแปร ค่าว่าง และ Outlier</h2>
              </div>
              <p className="text-slate-500 mb-4">เลือกเฉพาะคอลัมน์ที่ต้องการ กำหนดค่าแทนที่ช่องว่าง (Missing Values) และเลือกวิธีจัดการ Outlier</p>
              
              {/* Variable Selection */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-4">
                <div className="flex space-x-3 w-full overflow-x-auto pb-2">
                  <button onClick={() => setSelectedCols([...headers])} className="text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors whitespace-nowrap">เลือกทั้งหมด</button>
                  <button onClick={() => {
                    const masterNames = activePipelineVars.map(m => m.originalName.toLowerCase());
                    const matchedCols = headers.filter(h => masterNames.includes(h.toLowerCase()));
                    setSelectedCols(matchedCols);
                  }} className="text-sm px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-md font-medium transition-colors whitespace-nowrap">เลือกเฉพาะใน Master</button>
                  <button onClick={() => setSelectedCols([])} className="text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors whitespace-nowrap">ล้างค่าทั้งหมด</button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3 max-h-48 overflow-y-auto">
                  {headers.map(h => {
                    const dName = getDisplayName(h);
                    const isSelected = selectedCols.includes(h);
                    const isMaster = activePipelineVars.some(m => m.originalName.toLowerCase() === h.toLowerCase());
                    const isSpec = activePipelineVars.some(m => m.originalName.toLowerCase() === h.toLowerCase() && m.type === 'spec');
                    
                    return (
                      <label key={h} className={`flex items-start p-2 rounded-lg border cursor-pointer transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleColumn(h)} className="w-3.5 h-3.5 mt-1 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 mr-2" />
                        <div className="flex flex-col overflow-hidden">
                          <span className={`text-xs truncate font-bold ${isSelected ? 'text-indigo-900' : 'text-slate-700'} ${isMaster && !isSelected ? 'text-emerald-600' : ''}`} title={dName}>{dName}</span>
                          {isMaster && <span className="text-[9px] uppercase font-bold text-emerald-500">{isSpec ? 'Spec Var' : 'Gen Var'}</span>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Data Cleansing Config */}
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-col gap-5">
                
                {/* 1. Missing Values */}
                <div>
                   <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center"><Filter size={16} className="mr-2 text-indigo-500"/> การจัดการค่าว่าง (Missing Values)</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <label className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-100 cursor-pointer">
                        <input type="checkbox" checked={dropCoreMissing} onChange={e => setDropCoreMissing(e.target.checked)} className="rounded text-indigo-600 w-4 h-4" />
                        <span className="text-sm font-medium text-slate-700">ลบแถวที่ขาดข้อมูลหลัก (Part Id, Result, Date)</span>
                     </label>

                     <div className="flex flex-col space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <div className="flex items-center space-x-3">
                          <span className="text-sm font-medium text-slate-700">จัดการค่าว่างที่เหลือด้วย:</span>
                          <select value={imputeMethod} onChange={e => setImputeMethod(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white w-full max-w-[200px]">
                            <option value="none">ปล่อยผ่าน (ไม่แก้ไข)</option>
                            <option value="custom">แทนที่ด้วยค่ากำหนดเอง</option>
                            <option value="median">ใช้ค่ามัธยฐาน (Median)</option>
                            <option value="ffill">ใช้ข้อมูลก่อนหน้า (Forward Fill)</option>
                          </select>
                        </div>
                        {imputeMethod === 'custom' && (
                          <input type="text" placeholder="ระบุคำที่จะใช้แทนที่ เช่น 0, N/A" value={fillMissingValue} onChange={e => setFillMissingValue(e.target.value)} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none w-full" />
                        )}
                     </div>
                   </div>
                </div>

                <div className="h-px bg-slate-100 w-full"></div>

                {/* 2. Outliers */}
                <div>
                   <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center"><Activity size={16} className="mr-2 text-indigo-500"/> การจัดการความผิดปกติ (Outliers)</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <span className="text-sm font-medium text-slate-700 shrink-0">ตรวจจับ Outlier ด้วยวิธี:</span>
                        <select value={outlierMethod} onChange={e => setOutlierMethod(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-semibold bg-white w-full">
                          <option value="none">ไม่ตรวจจับ (None)</option>
                          <option value="spec">หลุด Spec (LSL/USL)</option>
                          <option value="iqr">IQR (Q1-1.5*IQR ถึง Q3+1.5*IQR)</option>
                          <option value="zscore">ทางสถิติ Z-Score (&gt; 3 SD)</option>
                        </select>
                     </div>
                     <label className={`flex items-center space-x-3 bg-slate-50 p-3 rounded-lg border border-slate-100 cursor-pointer`}>
                        <input type="checkbox" checked={flagOutlier} onChange={e => setFlagOutlier(e.target.checked)} disabled={outlierMethod === 'none'} className="rounded text-indigo-600 w-4 h-4 disabled:opacity-50" />
                        <div className="flex flex-col">
                          <span className={`text-sm font-medium ${outlierMethod === 'none' ? 'text-slate-400' : 'text-slate-700'}`}>ทำ Flag (บันทึกสถานะ) แทนการลบข้อมูลทิ้ง</span>
                          <span className={`text-xs ${outlierMethod === 'none' ? 'text-slate-300' : 'text-slate-500'}`}>สร้างคอลัมน์ Outlier_Status เพื่อทำ Root Cause Analysis</span>
                        </div>
                     </label>
                   </div>
                </div>

            </div>

            {/* AI Cleaning Assistant Button */}
            <div className="mb-4 flex flex-col items-start w-full">
              <button
                onClick={generateCleaningInsight}
                disabled={selectedCols.length === 0 || isAiCleanLoading}
                className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white rounded-lg shadow-sm font-medium flex items-center text-sm transition-all disabled:opacity-50 transform hover:scale-[1.02]"
              >
                {isAiCleanLoading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Sparkles size={16} className="mr-2 text-purple-200" />}
                ✨ ขอคำแนะนำการตั้งค่า Clean ข้อมูลจาก AI
              </button>

              {aiCleanInsight && (
                <div className="mt-4 bg-purple-50 border border-purple-100 rounded-lg p-4 text-slate-700 text-sm leading-relaxed w-full shadow-sm animate-in fade-in">
                  <h4 className="font-bold text-purple-900 mb-2 flex items-center"><Sparkles size={16} className="mr-2 text-purple-600" /> คำแนะนำจาก Gemini AI</h4>
                  <div className="prose prose-sm prose-purple max-w-none">
                     {aiCleanInsight.split('\n').map((line, i) => (
                        <p key={i} className="mb-1" dangerouslySetInnerHTML={{__html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}}></p>
                     ))}
                  </div>
                </div>
              )}
            </div>
            </div>

            <div className="flex justify-between items-center mt-auto">
              <button onClick={() => setCurrentStep(3)} className="px-6 py-3 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors">ย้อนกลับ</button>
              <button onClick={executeCleanData} disabled={selectedCols.length === 0} className={`px-6 py-3 rounded-xl font-bold flex items-center shadow-lg transition-all ${selectedCols.length > 0 ? 'bg-indigo-600 hover:bg-indigo-700 text-white hover:shadow-indigo-200' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
                <Play size={20} className="mr-2" /> 5. Clean Data & Transform
              </button>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="animate-in fade-in slide-in-from-bottom-8 h-full flex flex-col">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 flex items-center justify-between mb-6 shadow-sm flex-shrink-0 flex-wrap gap-4">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center mr-4 shrink-0"><CheckCircle2 size={28} /></div>
                <div>
                  <h2 className="text-xl font-bold text-emerald-900">5. สำเร็จ! ข้อมูลถูกคลีนและพร้อมใช้งาน</h2>
                  <p className="text-emerald-700 text-sm mt-1">บันทึกลง History แล้ว ({cleanedData.length.toLocaleString()} แถว, {cleanedHeaders.length} ตัวแปร)</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center bg-white border border-emerald-300 rounded-lg overflow-hidden shadow-sm h-[38px]">
                  <input 
                    type="text" 
                    value={exportFileName}
                    onChange={(e) => setExportFileName(e.target.value)}
                    placeholder="ตั้งชื่อไฟล์..."
                    className="px-3 py-2 text-sm outline-none w-48 text-slate-700"
                  />
                </div>
                <div className="flex bg-emerald-600 rounded-lg shadow-sm h-[38px] overflow-hidden">
                   <button onClick={() => exportToCSV(cleanedHeaders, cleanedData, `${exportFileName || 'cleaned_data'}.csv`)} className="px-4 py-2 text-white hover:bg-emerald-700 font-medium transition-colors text-sm flex items-center border-r border-emerald-700">
                     <Download size={16} className="mr-2" /> CSV
                   </button>
                   <button onClick={() => exportToExcel(cleanedHeaders, cleanedData, `${exportFileName || 'cleaned_data'}.xlsx`)} className="px-4 py-2 text-white hover:bg-emerald-700 font-medium transition-colors text-sm flex items-center">
                     <FileSpreadsheet size={16} className="mr-2" /> Excel
                   </button>
                </div>
                
                <button onClick={() => resetPipeline()} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-medium transition-colors text-sm h-[38px] ml-2">เริ่มงานใหม่</button>
              </div>
            </div>

            <div className="flex justify-end mb-4">
              <button onClick={() => setCurrentStep(6)} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm text-sm flex items-center hover:scale-105 transform">
                ไปหน้าวิเคราะห์ขั้นสูง (Analytics Dashboard) <ArrowRight size={16} className="ml-2" />
              </button>
            </div>

            {/* AI Root Cause Analysis Section */}
            {flagOutlier && cleanedHeaders.includes('Outlier_Status') && (
              <div className="mb-6 border-t border-slate-200 pt-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4">
                  <h4 className="text-lg font-bold text-slate-800 flex items-center">
                    <Sparkles className="mr-2 text-rose-500" size={20} /> วิเคราะห์หาสาเหตุรากเหง้า (AI Root Cause Analysis)
                  </h4>
                  {!aiRcaInsight && !isAiRcaLoading && (
                    <button onClick={generateRcaInsight} className="px-4 py-2 bg-gradient-to-r from-rose-500 to-red-500 hover:from-rose-600 hover:to-red-600 text-white rounded-lg shadow-sm font-medium flex items-center text-sm transition-all transform hover:scale-105">
                      ✨ สรุป Root Cause ตามหลัก 4M1E
                    </button>
                  )}
                </div>
                
                {isAiRcaLoading && (
                  <div className="flex items-center justify-center p-8 bg-rose-50/50 rounded-xl border border-rose-100">
                     <div className="flex space-x-3 items-center text-rose-600">
                       <Loader2 size={24} className="animate-spin" />
                       <span className="font-medium">Gemini กำลังประมวลผล Outlier และวิเคราะห์หา Root Cause...</span>
                     </div>
                  </div>
                )}
                
                {aiRcaInsight && (
                  <div className="bg-gradient-to-br from-rose-50 to-red-50 border border-rose-200 rounded-xl p-6 text-slate-800 text-sm leading-relaxed shadow-sm">
                    <div className="prose prose-sm prose-rose max-w-none">
                       {aiRcaInsight.split('\n').map((line, i) => (
                          <p key={i} className="mb-2" dangerouslySetInnerHTML={{__html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}}></p>
                       ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-grow overflow-auto bg-white rounded-xl border border-slate-200 shadow-sm relative">
               <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="sticky top-0 bg-slate-100 z-10 shadow-sm">
                  <tr>
                    <th className="px-3 py-2 w-12 text-center text-slate-400 border-b border-slate-200">#</th>
                    {cleanedHeaders.map((h, i) => <th key={i} className={`px-4 py-3 border-b border-slate-200 font-bold ${h === 'Outlier_Status' ? 'text-amber-600 bg-amber-50' : 'text-indigo-800'}`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {cleanedData.slice(0, 100).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors border-b border-slate-50">
                      <td className="px-3 py-2 text-center border-r border-slate-100 text-slate-400 bg-slate-50/50">{idx + 1}</td>
                      {cleanedHeaders.map((h, i) => {
                         const val = row[h] || '';
                         const isFlag = h === 'Outlier_Status';
                         const isFail = isFlag && val.includes('Fail');
                         return (
                           <td key={`${idx}-${i}`} className={`px-4 py-2 truncate max-w-[250px] ${isFail ? 'text-red-600 font-medium bg-red-50/50' : 'text-slate-600'}`}>{val}</td>
                         )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2 text-right">แสดงตัวอย่าง 100 แถวแรก</p>
          </div>
        );
        
      case 6:
        return (
          <div className="animate-in fade-in h-full flex flex-col">
            <div className="mb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-3xl font-extrabold text-slate-800 flex items-center tracking-tight">
                  <BarChart2 className="mr-3 text-indigo-600" size={32} /> Analytics Dashboard
                </h2>
                <p className="text-slate-500 mt-1 pl-11 text-sm font-medium">ศูนย์ควบคุมการวิเคราะห์ข้อมูลอุตสาหกรรม (V3.0.0)</p>
              </div>
              <button onClick={() => { 
                  if(analysisReport) setAnalysisReport(null); 
                  else setCurrentStep(5);
               }} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 font-bold transition-all shadow-sm text-sm">
                 {analysisReport ? 'กลับไปหน้าตั้งค่า' : 'ย้อนกลับ'}
              </button>
            </div>

            {analysisReport ? (
              <div className="flex-grow flex flex-col min-h-0">
                <div className="flex justify-between items-center mb-4 px-2">
                    <span className="font-bold text-slate-700">
                        {analysisReport.mode === 'capability' ? 'ผลวิเคราะห์ Capability (Multiple Variables)' : 'ผลการทดสอบสมมติฐาน (Hypothesis)'}
                    </span>
                    <button onClick={handleSaveAnalysisReport} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-slate-900 transition-colors flex items-center">
                        <Save size={16} className="mr-2"/> บันทึกเข้า Library
                    </button>
                </div>

                <div className="flex-grow overflow-auto bg-slate-100 rounded-xl custom-scrollbar space-y-6 pb-6">
                    {/* Render Results Loop */}
                    {analysisReport.mode === 'capability' ? (
                        analysisReport.results.map((res, i) => <VariableReportCard key={i} varData={res} />)
                    ) : (
                        <HypothesisTestDisplay result={analysisReport} />
                    )}

                    {/* AI Insight Box */}
                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mx-1">
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="text-lg font-bold text-slate-800 flex items-center">
                          <Sparkles className="mr-2 text-amber-500" size={20} /> AI Analysis Summary
                        </h4>
                        {!aiInsight && !isAiLoading && (
                          <button onClick={generateInsight} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg shadow-sm font-bold flex items-center text-sm transition-all transform hover:scale-105">
                            ✨ ให้ AI สรุปรายงาน
                          </button>
                        )}
                      </div>
                      
                      {isAiLoading && (
                        <div className="flex items-center justify-center p-6 text-amber-600">
                           <Loader2 size={24} className="animate-spin mr-3" />
                           <span className="font-medium">กำลังประมวลผลข้อมูลทางสถิติ...</span>
                        </div>
                      )}
                      
                      {aiInsight && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 text-slate-800 text-sm leading-relaxed shadow-sm">
                          <div className="prose prose-sm prose-amber max-w-none">
                             {aiInsight.split('\n').map((line, i) => (
                                <p key={i} className="mb-2" dangerouslySetInnerHTML={{__html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')}}></p>
                             ))}
                          </div>
                        </div>
                      )}
                    </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex-grow flex flex-col md:flex-row overflow-hidden">
                
                {/* Left Side: Configuration Sidebar */}
                <div className="w-full md:w-80 bg-slate-50 border-r border-slate-200 p-6 flex flex-col overflow-y-auto">
                    <h3 className="font-bold text-lg text-slate-800 mb-6 uppercase tracking-wider">Analysis Setup</h3>
                    
                    <div className="mb-6">
                        <label className="block text-sm font-bold text-slate-700 mb-2">1. โหมดการวิเคราะห์</label>
                        <div className="flex bg-slate-200 p-1 rounded-lg">
                            <button onClick={()=>setAnalysisMode('capability')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${analysisMode === 'capability' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>Capability</button>
                            <button onClick={()=>setAnalysisMode('hypothesis')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-colors ${analysisMode === 'hypothesis' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>Hypothesis</button>
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-bold text-slate-700 mb-2 flex justify-between items-center">
                            <span>2. ชุดข้อมูล (Datasets)</span>
                            <button onClick={() => directUploadRef.current?.click()} className="text-[10px] bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-2 py-1 rounded flex items-center font-semibold transition-colors">
                               <Upload size={12} className="mr-1"/> นำเข้าข้อมูล
                            </button>
                        </label>
                        <input type="file" accept=".csv, .xlsx, .xls" className="hidden" ref={directUploadRef} onChange={handleDirectDataUpload} />
                        <div className="space-y-2 max-h-32 overflow-y-auto p-2 border border-slate-200 rounded-lg bg-white">
                          {cleanedData.length > 0 && (
                              <label className="flex items-center space-x-2 cursor-pointer p-1">
                                <input type="checkbox" checked={selectedAnalysisDatasets.includes('current')} onChange={(e) => { if (e.target.checked) setSelectedAnalysisDatasets([...selectedAnalysisDatasets, 'current']); else setSelectedAnalysisDatasets(selectedAnalysisDatasets.filter(id => id !== 'current')); }} className="rounded text-indigo-600 w-4 h-4" />
                                <span className="text-xs font-medium text-indigo-800">Current ({cleanedData.length} แถว)</span>
                              </label>
                          )}
                          {dataHistory.map(h => (
                            <label key={h.id} className="flex items-center space-x-2 cursor-pointer p-1">
                              <input type="checkbox" checked={selectedAnalysisDatasets.includes(h.id)} onChange={(e) => { if (e.target.checked) setSelectedAnalysisDatasets([...selectedAnalysisDatasets, h.id]); else setSelectedAnalysisDatasets(selectedAnalysisDatasets.filter(id => id !== h.id)); }} className="rounded text-indigo-600 w-4 h-4" />
                              <span className="text-xs text-slate-700 truncate" title={h.timestamp}>Backup: {h.timestamp}</span>
                            </label>
                          ))}
                        </div>
                    </div>

                    {analysisMode === 'hypothesis' && (
                        <div className="mb-6 animate-in fade-in">
                            <label className="block text-sm font-bold text-slate-700 mb-2">3. เลือกเครื่องมือทดสอบ</label>
                            <select value={analysisToolHypo} onChange={e=>setAnalysisToolHypo(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:ring-2 outline-none">
                                <option value="ttest">2-Sample T-Test</option>
                                <option value="anova">One-Way ANOVA</option>
                            </select>

                            <label className="block text-sm font-bold text-slate-700 mt-4 mb-2">กลุ่ม (X) & ตัวแปร (Y)</label>
                            <select value={hypoGroupingCol} onChange={e=>setHypoGroupingCol(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2 text-xs mb-2 bg-slate-50">
                                <option value="dataset_source">แบ่งกลุ่มตาม: Dataset (Current vs History)</option>
                                {/* In a full app, we'd add categorical columns here */}
                            </select>
                            <select value={analysisTargetCol} onChange={e=>setAnalysisTargetCol(e.target.value)} className="w-full border border-indigo-300 rounded-md px-3 py-2 text-xs bg-white text-indigo-800 font-bold">
                                {availableAnalysisHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                        </div>
                    )}

                    {analysisMode === 'capability' && (
                        <div className="mb-6 animate-in fade-in">
                             <label className="block text-sm font-bold text-slate-700 mb-2">3. เลือกตัวแปรเป้าหมาย (เลือกหลายตัวได้)</label>
                             <div className="flex space-x-2 w-full mb-2">
                                <button onClick={() => setSelectedAnalysisVars([...availableAnalysisHeaders])} className="text-[10px] px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded font-bold">เลือกทั้งหมด</button>
                                <button onClick={() => setSelectedAnalysisVars([])} className="text-[10px] px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded font-bold">ล้าง</button>
                             </div>
                             <div className="space-y-1 max-h-40 overflow-y-auto p-2 border border-slate-200 rounded-lg bg-white custom-scrollbar">
                                {availableAnalysisHeaders.map(h => (
                                    <label key={h} className="flex items-center space-x-2 cursor-pointer p-1 hover:bg-slate-50 rounded">
                                        <input type="checkbox" checked={selectedAnalysisVars.includes(h)} onChange={(e) => {
                                            if (e.target.checked) setSelectedAnalysisVars([...selectedAnalysisVars, h]);
                                            else setSelectedAnalysisVars(selectedAnalysisVars.filter(v => v !== h));
                                        }} className="rounded text-indigo-600 w-3.5 h-3.5" />
                                        <span className={`text-xs truncate ${selectedAnalysisVars.includes(h)?'font-bold text-indigo-700':'text-slate-600'}`}>{h}</span>
                                    </label>
                                ))}
                             </div>
                        </div>
                    )}

                    <div className="mt-auto border-t border-slate-200 pt-4">
                        <label className="block text-xs font-bold text-indigo-900 mb-2 flex items-center"><Scissors size={14} className="mr-1"/> Data Trimming</label>
                        <label className="flex items-center space-x-2 cursor-pointer mb-2">
                            <input type="checkbox" checked={analysisFilterExcludeOutliers} onChange={e => setAnalysisFilterExcludeOutliers(e.target.checked)} className="rounded text-indigo-600 w-3.5 h-3.5" />
                            <span className="text-[11px] text-slate-600 font-medium">ไม่รวมข้อมูลที่ติด Outlier (Fail)</span>
                        </label>
                        <div className="flex items-center space-x-2">
                           <span className="text-[11px] text-slate-600 font-medium">ตัดหัวท้าย:</span>
                           <input type="range" min="0" max="25" value={analysisFilterTrimPercent} onChange={e => setAnalysisFilterTrimPercent(Number(e.target.value))} className="w-20" />
                           <span className="text-[11px] font-bold">{analysisFilterTrimPercent}%</span>
                        </div>
                    </div>
                </div>

                {/* Right Side: Main Area Config */}
                <div className="flex-1 p-8 bg-white overflow-y-auto custom-scrollbar flex flex-col relative">
                    {analysisMode === 'capability' ? (
                        <div className="animate-in fade-in">
                            <h3 className="text-xl font-bold text-slate-800 mb-6 pb-2 border-b border-slate-100 flex items-center">
                                <Settings2 className="mr-2 text-indigo-500"/> ตั้งค่าพารามิเตอร์ของตัวแปร (Overrides)
                            </h3>
                            
                            <div className="mb-6 flex items-center space-x-4 bg-slate-50 p-4 rounded-xl border border-slate-100 w-max">
                               <label className="text-sm font-bold text-slate-700">Distribution Type:</label>
                               <select value={distType} onChange={e=>setDistType(e.target.value)} className="border border-slate-300 rounded px-3 py-1 text-sm outline-none bg-white font-semibold text-indigo-700">
                                   <option value="Normal">Normal Distribution</option>
                                   <option value="Weibull">Weibull (Beta)</option>
                               </select>
                            </div>

                            {selectedAnalysisVars.length === 0 ? (
                                <div className="text-center text-slate-400 py-10 border-2 border-dashed border-slate-200 rounded-xl">
                                    ← กรุณาเลือกตัวแปรเป้าหมายจากหน้าต่างด้านซ้าย
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-12 gap-4 text-xs font-bold text-slate-500 uppercase tracking-wider px-2">
                                        <div className="col-span-5">Variable Name</div>
                                        <div className="col-span-3 text-center border-b-2 border-rose-300 pb-1">LSL Override</div>
                                        <div className="col-span-1 text-center"></div>
                                        <div className="col-span-3 text-center border-b-2 border-rose-300 pb-1">USL Override</div>
                                    </div>
                                    {selectedAnalysisVars.map(col => {
                                        const ov = specOverrides[col] || {lsl:'', usl:''};
                                        const updateOv = (field, val) => setSpecOverrides({...specOverrides, [col]: {...ov, [field]: val}});
                                        return (
                                            <div key={col} className="grid grid-cols-12 gap-4 items-center bg-slate-50 p-3 rounded-lg border border-slate-100">
                                                <div className="col-span-5 font-bold text-sm text-indigo-900 truncate">{col}</div>
                                                <div className="col-span-3">
                                                    <input type="number" placeholder="ค่าสเปคต่ำ" value={ov.lsl} onChange={(e)=>updateOv('lsl', e.target.value)} className="w-full text-center border border-slate-300 rounded py-1.5 text-sm font-mono focus:ring-1 focus:ring-indigo-500 outline-none"/>
                                                </div>
                                                <div className="col-span-1 text-center text-slate-300">-</div>
                                                <div className="col-span-3">
                                                    <input type="number" placeholder="ค่าสเปคสูง" value={ov.usl} onChange={(e)=>updateOv('usl', e.target.value)} className="w-full text-center border border-slate-300 rounded py-1.5 text-sm font-mono focus:ring-1 focus:ring-indigo-500 outline-none"/>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="animate-in fade-in text-center py-20">
                            <CheckSquare size={48} className="mx-auto text-indigo-200 mb-4" />
                            <h3 className="text-lg font-bold text-slate-700 mb-2">พร้อมสำหรับการทดสอบสมมติฐาน</h3>
                            <p className="text-sm text-slate-500">กรุณากดปุ่ม <b>Run Report</b> เพื่อประมวลผล T-Test หรือ ANOVA</p>
                        </div>
                    )}

                    <div className="mt-auto pt-6">
                        <button onClick={runAnalysis} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg hover:bg-indigo-700 hover:shadow-lg transition-all flex items-center justify-center">
                            <Play size={20} className="mr-2" /> สร้างรายงานสรุปผล (Run Report)
                        </button>
                    </div>
                </div>

              </div>
            )}
          </div>
        );
        
      default: return null;
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-100 font-sans text-slate-800 overflow-hidden">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center px-4 py-3 rounded-lg shadow-lg text-white animate-in fade-in slide-in-from-top-4 ${notification.type === 'error' ? 'bg-red-500' : 'bg-emerald-600'}`}>
          {notification.type === 'error' ? <AlertCircle size={18} className="mr-2" /> : <Check size={18} className="mr-2" />}
          {notification.message}
        </div>
      )}

      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between bg-slate-900 border-b border-slate-800 p-4 shrink-0 z-20 shadow-md">
         <div className="flex items-center text-white">
            <Database className="text-indigo-400 mr-2" size={20} />
            <h1 className="text-lg font-black tracking-tight">Data Wizard</h1>
            <span className="ml-2 text-[10px] text-slate-400 border border-slate-700 rounded-full px-2">{APP_VERSION}</span>
         </div>
         <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 hover:bg-slate-800 rounded-lg text-slate-300 transition-colors">
           <Menu size={24} />
         </button>
      </div>

      {/* Sidebar Navigation */}
      <div className={`fixed inset-y-0 left-0 z-40 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-300 ease-in-out w-72 bg-slate-900 text-slate-300 flex flex-col shadow-2xl md:shadow-sm flex-shrink-0`}>
        {/* Close button inside sidebar for mobile */}
        <div className="md:hidden absolute top-4 right-4 z-50">
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg text-slate-400 transition-colors">
                <XCircle size={24} />
            </button>
        </div>

        <div className="hidden md:block p-6 border-b border-slate-800">
          <div className="flex items-center justify-between text-white mb-1">
            <div className="flex items-center">
               <Database className="text-indigo-400 mr-2" size={24} />
               <h1 className="text-xl font-bold tracking-tight">Data Wizard</h1>
            </div>
            <span className="text-[10px] text-slate-500 border border-slate-700 rounded-full px-2">{APP_VERSION}</span>
          </div>
          <p className="text-xs text-slate-400 pl-8">ระบบเตรียมข้อมูลอัตโนมัติ</p>
        </div>

        <div className="p-4 flex-grow overflow-y-auto flex flex-col custom-scrollbar mt-12 md:mt-0">
          
          {/* Main Top Menus */}
          <div className="space-y-2 mb-6">
            <button 
              onClick={() => { setActiveView('master_view'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors border ${activeView === 'master_view' ? 'bg-indigo-600 text-white border-indigo-500 shadow-md' : 'bg-slate-800 border-slate-700 text-indigo-300 hover:bg-slate-700'}`}
            >
              <span className="flex items-center"><Settings2 size={16} className="mr-2" /> ตั้งค่า & Master</span>
              <span className="bg-indigo-900/50 text-indigo-200 px-2 py-0.5 rounded-full text-xs">{activePipelineVars.length}</span>
            </button>
            <button 
              onClick={() => { setActiveView('library'); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors border ${activeView === 'library' ? 'bg-emerald-600 text-white border-emerald-500 shadow-md' : 'bg-slate-800 border-slate-700 text-emerald-300 hover:bg-slate-700'}`}
            >
              <span className="flex items-center"><FolderOpen size={16} className="mr-2" /> คลังข้อมูล (Data Library)</span>
              <span className="bg-emerald-900/50 text-emerald-200 px-2 py-0.5 rounded-full text-xs">{history.length}</span>
            </button>
          </div>

          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-2 flex justify-between items-center">
            <span>ขั้นตอน (Pipeline)</span>
            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] truncate max-w-[80px]">{currentModel}</span>
          </h2>
          
          <div className="space-y-1 mb-8 relative">
            {/* Connection Line */}
            <div className="absolute left-[19px] top-4 bottom-4 w-px bg-slate-700 -z-10"></div>
            
            {[
              { step: 1, icon: Upload, title: '1. อัปโหลดไฟล์' },
              { step: 2, icon: Layers, title: '2. รวมไฟล์ (Smart Merge)' },
              { step: 3, icon: List, title: '3. ดึง Header & กรอง' },
              { step: 4, icon: CheckSquare, title: '4. จัดการตัวแปร' },
              { step: 5, icon: Download, title: '5. คลีน & ดาวน์โหลด' },
              { step: 6, icon: BarChart2, title: '6. วิเคราะห์ข้อมูล' }
            ].map((s) => {
              const isDisabled = currentStep < s.step && s.step !== 6;
              const isActive = currentStep === s.step && activeView === 'pipeline';
              const isPast = !isDisabled && currentStep > s.step;
              const StepIcon = s.icon;
              
              return (
                <button 
                  key={s.step}
                  onClick={() => { if (!isDisabled) { setActiveView('pipeline'); setCurrentStep(s.step); setIsMobileMenuOpen(false); } }}
                  disabled={isDisabled}
                  className={`w-full flex items-center px-2 py-2 rounded-lg text-sm font-medium transition-all text-left ${isActive ? 'bg-slate-800 text-white shadow-md' : !isDisabled ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50' : 'text-slate-600 cursor-not-allowed opacity-50'}`}
                >
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center mr-3 z-10 transition-colors ${isActive ? 'bg-indigo-500 text-white' : isPast && s.step !== 6 ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    {isPast && s.step !== 6 ? <Check size={12} strokeWidth={3}/> : <StepIcon size={12} />}
                  </div>
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
          </div>

        </div>
      </div>

      {/* Overlay for mobile sidebar */}
      {isMobileMenuOpen && (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-30 md:hidden transition-opacity" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {/* Main Content Area */}
      <div className="flex-grow p-4 md:p-8 overflow-auto flex flex-col bg-slate-50/50 relative">
        <div className="absolute inset-0 bg-slate-100 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '24px 24px', opacity: 0.5 }}></div>
        <div className="max-w-6xl mx-auto w-full min-h-full flex flex-col relative z-10">
          {activeView === 'master_view' ? renderMasterView() : 
           activeView === 'library' ? renderLibraryDashboard() :
           activeView === 'history_view' ? renderHistoryView() : 
           renderPipelineStep()}
        </div>
      </div>
      
    </div>
  );
}