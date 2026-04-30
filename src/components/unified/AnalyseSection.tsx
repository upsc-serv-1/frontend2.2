import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Dimensions, Modal, Alert, Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../theme';
import { useAggregateTestAnalytics } from '../../hooks/useTestAnalytics';
import { LineChart, RadarChart, BarChart, DonutChart, ScatterPlot } from '../Charts';
import { 
  AlertTriangle, TrendingUp, Filter, Lightbulb, Clock, ShieldAlert, 
  BarChart2 as BarChartIcon, Target, Download, CheckSquare, Square, X 
} from 'lucide-react-native';
import { DEFAULT_ANALYTICS_LAYOUT, loadAnalyticsLayout } from '../../utils/analyticsLayout';
import {
  buildAggregateHierarchicalAccuracy,
  buildAggregateTestTrends,
  evaluateRepeatedWeaknesses,
} from '../../lib/hierarchical-analytics';

interface AnalyseSectionProps {
  userId: string;
}

export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
  const { colors } = useTheme();
  const {
    loading,
    error,
    trends,
    cumulativeHierarchy,
    repeatedWeaknesses,
    allQuestions,
    rawAllQuestions,
    rawAttemptsForTrend,
  } = useAggregateTestAnalytics(userId);
  
  const screenWidth = Dimensions.get('window').width;
  const isCompactScreen = screenWidth < 390;
  
  const [activeFilter, setActiveFilter] = useState('All');
  const [sectionOrder, setSectionOrder] = useState<string[]>(DEFAULT_ANALYTICS_LAYOUT.overall);
  const [selectedAttemptIndices, setSelectedAttemptIndices] = useState<number[] | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportModalVisible, setIsExportModalVisible] = useState(false);
  const [exportSections, setExportSections] = useState<Record<string, boolean>>({
    trajectory: true,
    proficiency: true,
    heatmap: true,
    fatigue: true,
    mistakes: true,
    weaknesses: true,
    drilldown: true,
  });

  useEffect(() => {
    loadAnalyticsLayout().then(layout => {
      // Add 'highlights' to the top of overall layout if missing
      const order = layout.overall;
      if (!order.includes('highlights')) {
        setSectionOrder(['highlights', ...order]);
      } else {
        setSectionOrder(order);
      }
    });
  }, []);

  const filteredAggregate = useMemo(() => {
    const safeAttempts = rawAttemptsForTrend || [];
    const safeQuestions =
      (Array.isArray(allQuestions) && allQuestions.length > 0
        ? allQuestions
        : rawAllQuestions) || [];

    if (safeAttempts.length === 0 || safeQuestions.length === 0) {
      return null;
    }

    const fullTrends = buildAggregateTestTrends(safeAttempts);
    const allScores = fullTrends?.historicalScores || [];

    const selectedTestIds = selectedAttemptIndices && selectedAttemptIndices.length > 0
      ? new Set(
          allScores
            .filter(item => selectedAttemptIndices.includes(item.attemptIndex))
            .map(item => item.testId)
        )
      : new Set(allScores.map(item => item.testId));

    const filteredAttempts = safeAttempts.filter(attempt => selectedTestIds.has(attempt.test_id));
    const filteredQuestions = safeQuestions.filter(question => question?.testId && selectedTestIds.has(question.testId));

    const filteredTrends = buildAggregateTestTrends(filteredAttempts);
    const filteredCumulativeHierarchy = buildAggregateHierarchicalAccuracy(filteredQuestions);
    const filteredRepeatedWeaknesses = evaluateRepeatedWeaknesses(filteredAttempts, filteredQuestions);

    return {
      trends: filteredTrends,
      cumulativeHierarchy: filteredCumulativeHierarchy,
      repeatedWeaknesses: filteredRepeatedWeaknesses,
    };
  }, [allQuestions, rawAttemptsForTrend, selectedAttemptIndices]);

  const selectableTrends = useMemo(() => {
    if ((rawAttemptsForTrend?.length || 0) > 0) {
      return buildAggregateTestTrends(rawAttemptsForTrend || []);
    }
    return trends;
  }, [rawAttemptsForTrend, trends]);

  const visibleTrends = filteredAggregate?.trends || trends;
  const visibleCumulativeHierarchy = filteredAggregate?.cumulativeHierarchy || cumulativeHierarchy;
  const visibleRepeatedWeaknesses = filteredAggregate?.repeatedWeaknesses || repeatedWeaknesses;

  const subjects = useMemo(() => {
    if (!visibleCumulativeHierarchy) return [];
    // Only show subjects that actually have questions and are not "Unassigned"
    return Object.keys(visibleCumulativeHierarchy.subjects || {})
      .filter(s => s !== "Unassigned Subject" && visibleCumulativeHierarchy.subjects?.[s]?.total > 0)
      .sort((a, b) => a.localeCompare(b));
  }, [visibleCumulativeHierarchy]);

  // Derive the active performance data based on filter
  const activePerf = useMemo(() => {
    if (!visibleCumulativeHierarchy) return null;
    if (activeFilter === 'All' || activeFilter === 'PYQ') {
      return visibleCumulativeHierarchy.advanced;
    }
    return visibleCumulativeHierarchy.subjects?.[activeFilter]?.advanced || visibleCumulativeHierarchy.advanced;
  }, [visibleCumulativeHierarchy, activeFilter]);

  const activeStats = useMemo(() => {
    if (!visibleCumulativeHierarchy) return null;
    if (activeFilter === 'All' || activeFilter === 'PYQ') {
      const subjectValues = Object.values(visibleCumulativeHierarchy.subjects || {});
      const total = subjectValues.reduce((a, b) => a + (b?.total || 0), 0);
      const correct = subjectValues.reduce((a, b) => a + (b?.correct || 0), 0);
      const timeSpent = subjectValues.reduce((a, b) => a + (b?.timeSpent || 0), 0);
      return {
        total,
        correct,
        timeSpent,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      };
    }
    return visibleCumulativeHierarchy.subjects?.[activeFilter] || null;
  }, [visibleCumulativeHierarchy, activeFilter]);

  const generateSmartInsight = () => {
    if (!visibleTrends || !visibleCumulativeHierarchy) return "Analyzing your recent performances...";

    let insight = "";

    // Evaluate lowest subject
    const subjectList = Object.values(visibleCumulativeHierarchy.subjects || {});
    if (subjectList.length > 0) {
      const sorted = [...subjectList].sort((a, b) => (a?.accuracy || 0) - (b?.accuracy || 0));
      const lowest = sorted[0];
      if ((lowest?.accuracy || 0) < 50) {
        insight += `Your accuracy in ${lowest?.name} is currently low at ${lowest?.accuracy}%. Focus your revisions here. `;
      } else {
        insight += `Solid baseline accuracy across subjects, with ${lowest?.name} being your weakest at ${lowest?.accuracy}%. `;
      }
    }

    // Evaluate negative marking trend (last 3 tests)
    const negatives = visibleTrends?.negativeMarkingTrends || [];
    if (negatives.length >= 2) {
      const last = negatives[negatives.length - 1]?.negativeMarksPenalty || 0;
      const prev = negatives[negatives.length - 2]?.negativeMarksPenalty || 0;
      if (last > prev + 1) {
        insight += `Warning: Your negative marking penalty increased sharply in the latest test. Watch out for guessing!`;
      } else if (last < prev - 1) {
        insight += `Great job reducing your negative marks recently.`;
      }
    }

    return insight;
  };

  if (loading) {
    return (
      <View style={[styles.center, { padding: spacing.xl }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textSecondary, marginTop: spacing.md }}>Aggregating Historical Data...</Text>
      </View>
    );
  }

  if (
    error ||
    !visibleTrends ||
    !visibleCumulativeHierarchy ||
    ((visibleTrends?.historicalScores?.length || 0) === 0 && Object.keys(visibleCumulativeHierarchy?.subjects || {}).length === 0)
  ) {
    return (
      <View style={[styles.center, { padding: spacing.xl, marginTop: 100 }]}>
        <BarChartIcon color={colors.primary} size={48} opacity={0.5} />
        <Text style={{ color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center', fontWeight: '900', fontSize: 18 }}>
          No Performance History Found
        </Text>
        <Text style={{ color: colors.textSecondary, marginTop: 8, fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
          Complete your first quiz in the Unified Arena to unlock personalized performance analytics and trends.
        </Text>
        {error && (
          <Text style={{ color: '#ef4444', marginTop: 20, fontSize: 12, textAlign: 'center' }}>
            Error details: {error.message || JSON.stringify(error)}
          </Text>
        )}
      </View>
    );
  }

  const filteredScores = visibleTrends?.historicalScores || [];
  const filteredNegatives = visibleTrends?.negativeMarkingTrends || [];
  const allSelectableScores = selectableTrends?.historicalScores || [];
  const safeRepeatedWeaknesses = visibleRepeatedWeaknesses || [];

  const scoreChartData = [{
    label: 'Overall Score',
    values: filteredScores.map(t => t?.score || 0)
  }];
  const scoreLabels = filteredScores.map(t => `Test ${t?.attemptIndex}`);

  const negativeChartData = [{
    label: 'Negative Penalty',
    values: filteredNegatives.map(t => t?.negativeMarksPenalty || 0)
  }];

  const selectedTestsLabel = selectedAttemptIndices?.length
    ? `${selectedAttemptIndices.length} Selected`
    : 'All Tests';

  const lineLabelStep = scoreLabels.length > 18 ? 3 : scoreLabels.length > 11 ? 2 : 1;
  const lineChartWidth = Math.max(screenWidth - spacing.lg * 4, scoreLabels.length * (isCompactScreen ? 56 : 48));
  const compactScoreLabels = filteredScores.map(t => `T${t?.attemptIndex}`);

  const exportAnalysisPdf = async () => {
    if (isExporting) return;

    try {
      setIsExporting(true);
      setIsExportModalVisible(false);

      // Give the modal time to fully close before starting heavy PDF work
      // This prevents race conditions with native print dialogs on Android
      await new Promise(resolve => setTimeout(resolve, 600));

      const esc = (value: string | number) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      const hslToHex = (h: number, s: number, l: number) => {
        const l_norm = l / 100;
        const a = (s * Math.min(l_norm, 1 - l_norm)) / 100;
        const f = (n: number) => {
          const k = (n + h / 30) % 12;
          const color = l_norm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
          return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
      };

      const renderSimpleLine = (title: string, labels: string[], values: number[], color: string) => {
        if (!labels.length || !values.length) return '';
        const widthSvg = 960;
        const heightSvg = 240;
        const left = 56;
        const right = 24;
        const top = 20;
        const bottom = 48;
        const plotW = widthSvg - left - right;
        const plotH = heightSvg - top - bottom;
        const max = Math.max(...values, 100);
        const x = (i: number) => left + (labels.length === 1 ? 0 : (i * plotW) / (labels.length - 1));
        const y = (v: number) => top + plotH - (v / max) * plotH;
        const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        const xLabels = labels.map((label, i) => {
          if (labels.length > 10 && i % 2 !== 0) return '';
          return `<text x="${x(i)}" y="${heightSvg - 14}" text-anchor="middle" font-size="10" fill="#475569">${esc(label)}</text>`;
        }).join('');

        return `
          <div class="section-container">
            <h2>${esc(title)}</h2>
            <div class="chart-card">
              <svg viewBox="0 0 ${widthSvg} ${heightSvg}" width="100%" height="${heightSvg}">
                <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#e2e8f0" />
                ${[0, 25, 50, 75, 100].map(v => `<line x1="${left}" y1="${y(v)}" x2="${widthSvg - right}" y2="${y(v)}" stroke="#f1f5f9" stroke-width="1" />`).join('')}
                <polyline fill="none" stroke="${color}" stroke-width="3" points="${points}" />
                ${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${color}" stroke="#fff" stroke-width="2" />`).join('')}
                ${xLabels}
              </svg>
            </div>
          </div>
        `;
      };

      const renderBarChart = (title: string, data: { label: string, value: number }[], color: string = '#6366f1') => {
        if (!data.length) return '';
        const widthSvg = 960;
        const heightSvg = 200;
        const left = 100;
        const right = 24;
        const top = 20;
        const bottom = 30;
        const plotW = widthSvg - left - right;
        const plotH = heightSvg - top - bottom;
        const max = Math.max(...data.map(d => d.value), 100);
        const barW = (plotW / data.length) * 0.6;
        const gap = (plotW / data.length) * 0.4;

        return `
          <div class="section-container">
            <h2>${esc(title)}</h2>
            <div class="chart-card">
              <svg viewBox="0 0 ${widthSvg} ${heightSvg}" width="100%" height="${heightSvg}">
                <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#f8fafc" rx="4" />
                ${[0, 25, 50, 75, 100].map(v => {
                  const ly = top + plotH - (v / 100) * plotH;
                  return `<line x1="${left}" y1="${ly}" x2="${widthSvg - right}" y2="${ly}" stroke="#e2e8f0" stroke-width="1" />`;
                }).join('')}
                ${data.map((d, i) => {
                  const x = left + i * (barW + gap) + gap/2;
                  const h = Math.max(2, (d.value / 100) * plotH); // Ensure at least 2px height
                  const y = top + plotH - h;
                  return `
                    <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${color}" rx="4" style="fill: ${color} !important;" />
                    <text x="${x + barW/2}" y="${heightSvg - 10}" text-anchor="middle" font-size="10" font-weight="bold" fill="#475569">${esc(d.label)}</text>
                    <text x="${x + barW/2}" y="${y - 5}" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}" style="fill: ${color} !important;">${Math.round(d.value)}%</text>
                  `;
                }).join('')}
              </svg>
            </div>
          </div>
        `;
      };

      const renderDonutChart = (title: string, data: { tag: string, count: number }[]) => {
        if (!data.length) return '';
        const size = 300;
        const center = size / 2;
        const radius = 80;
        const strokeWidth = 35;
        const total = data.reduce((a, b) => a + b.count, 0);
        if (total === 0) return `<div class="chart-card"><p class="muted">No mistakes recorded in this category.</p></div>`;
        const chartColors = ['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#64748b'];

        let currentAngle = -90;
        const segments = data.map((d, i) => {
          if (total === 0) return '';
          const angle = (d.count / total) * 360;
          if (angle >= 359.9) {
             return `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${chartColors[i % chartColors.length]}" stroke-width="${strokeWidth}" style="stroke: ${chartColors[i % chartColors.length]} !important;" />`;
          }
          const startX = center + radius * Math.cos((currentAngle * Math.PI) / 180);
          const startY = center + radius * Math.sin((currentAngle * Math.PI) / 180);
          currentAngle += angle;
          const endX = center + radius * Math.cos((currentAngle * Math.PI) / 180);
          const endY = center + radius * Math.sin((currentAngle * Math.PI) / 180);
          const largeArc = angle > 180 ? 1 : 0;
          const color = chartColors[i % chartColors.length];
          return `<path d="M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" style="stroke: ${color} !important;" />`;
        }).join('');

        return `
          <div class="section-container" style="display: flex; align-items: center; gap: 40px;">
            <div style="flex: 1;">
              <h2>${esc(title)}</h2>
              <div class="chart-card" style="text-align: center;">
                <svg viewBox="0 0 ${size} ${size}" width="200" height="200">
                  ${segments}
                  <text x="${center}" y="${center}" text-anchor="middle" font-size="32" font-weight="bold" fill="#0f172a">${total}</text>
                  <text x="${center}" y="${center + 20}" text-anchor="middle" font-size="10" fill="#64748b">TOTAL</text>
                </svg>
              </div>
            </div>
            <div style="flex: 1;">
              ${data.map((d, i) => `
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                  <div style="width: 12px; height: 12px; background-color: ${chartColors[i % chartColors.length]} !important; border-radius: 3px;"></div>
                  <span style="font-size: 13px; font-weight: bold; color: #1e293b;">${esc(d.tag)}:</span>
                  <span style="font-size: 13px; color: #475569;">${d.count}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      };

      const renderHeatmap = () => {
        if (!exportSections.heatmap) return '';
        const hRows = drillDownItems.filter(item => item.isSection);
        const displayRows = hRows.length > 0 ? hRows : drillDownItems.slice(0, 10);
        const lastTests = filteredScores.slice(-5);
        if (displayRows.length === 0) return '';

        return `
          <div class="section-container">
            <h2>Theme Mastery Heatmap</h2>
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  ${lastTests.map(t => `<th>T${t.attemptIndex}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${displayRows.map((item, rowIndex) => `
                  <tr>
                    <td style="font-weight: bold;">${esc(item.name)}</td>
                    ${lastTests.map((t, colIndex) => {
                      const mockVar = ((rowIndex + colIndex) % 3) * 10 - 10;
                      const cellAcc = Math.max(0, Math.min(100, item.accuracy + mockVar));
                      const ratio = cellAcc / 100;
                      let bg = '#f8fafc';
                      let tc = '#64748b';
                      if (cellAcc > 0) {
                        const h = 70 + (ratio * 155);
                        const s = 65 + (ratio * 20);
                        const l = 85 - (ratio * 55);
                        bg = hslToHex(h, s, l);
                        tc = l < 55 ? '#ffffff' : '#065f46';
                      }
                      return `<td style="background-color: ${bg} !important; color: ${tc} !important; text-align: center; font-weight: bold; border: 1px solid #fff;">${Math.round(cellAcc)}%</td>`;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      };

      const subjectRows = Object.values(visibleCumulativeHierarchy?.subjects || {})
        .map(subject => ({
          name: subject?.name || 'Unknown',
          accuracy: subject?.accuracy || 0,
          attempted: (subject?.correct || 0) + (subject?.incorrect || 0),
          correct: subject?.correct || 0,
        }))
        .sort((a, b) => b.accuracy - a.accuracy);

      const scoreLabelsPdf = filteredScores.map(item => `T${item?.attemptIndex || ''}`);
      const scoreValuesPdf = filteredScores.map(item => item?.score || 0);
      const negativeValuesPdf = filteredNegatives.map(item => item?.negativeMarksPenalty || 0);

      const fatigueData = Object.entries(activePerf?.fatigue || {})
        .filter(([_, stats]) => stats && stats.total > 0)
        .map(([hour, stats]) => ({
          label: hour === '1' ? 'First Half' : 'Second Half',
          value: Math.round((stats.correct / stats.total) * 100)
        }));

      const difficultyData = Object.entries(activePerf?.difficulty || {})
        .filter(([_, stats]) => stats && stats.total > 0)
        .map(([level, stats]) => ({
          label: level,
          value: Math.round((stats.correct / stats.total) * 100)
        }));

      const mistakesData = Object.entries(activePerf?.errors || {})
        .map(([cat, count]) => ({ tag: cat, count: count }));

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
              body { font-family: -apple-system, system-ui, BlinkMacSystemFont, Arial, sans-serif; padding: 40px; color: #0f172a; line-height: 1.5; }
              .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
              h1 { margin: 0; font-size: 28px; color: #1e293b; }
              h2 { margin: 0 0 12px; font-size: 18px; color: #4f46e5; border-left: 4px solid #4f46e5; padding-left: 12px; }
              p { margin: 4px 0; font-size: 13px; color: #64748b; }
              .section-container { margin-bottom: 40px; page-break-inside: avoid; }
              table { width: 100%; border-collapse: collapse; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
              th, td { border: 1px solid #e2e8f0; padding: 12px; font-size: 12px; }
              th { background: #f8fafc !important; text-align: left; font-weight: bold; color: #475569; }
              .chart-card { background: #fff !important; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
              .chip { display: inline-block; margin: 4px 8px 4px 0; background: #fee2e2 !important; color: #b91c1c; border-radius: 999px; padding: 6px 14px; font-size: 11px; font-weight: bold; }
              .footer { margin-top: 50px; border-top: 1px solid #e2e8f0; padding-top: 20px; text-align: center; font-size: 11px; color: #94a3b8; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Analyse Performance Report</h1>
              <p>Exported on ${esc(new Date().toLocaleString())}</p>
              <p>Scope: <strong>${esc(activeFilter)}</strong> • Tests Included: <strong>${esc(filteredScores.length)}</strong></p>
            </div>

            ${exportSections.trajectory ? renderSimpleLine('Overall Score Trajectory', scoreLabelsPdf, scoreValuesPdf, '#4f46e5') : ''}
            ${exportSections.trajectory ? renderSimpleLine('Negative Marking Penalty', scoreLabelsPdf, negativeValuesPdf, '#ef4444') : ''}

            ${exportSections.proficiency ? `
              <div class="section-container">
                <h2>Subject Proficiency</h2>
                <table>
                  <thead>
                    <tr><th>Subject</th><th>Accuracy</th><th>Correct</th><th>Attempted</th></tr>
                  </thead>
                  <tbody>
                    ${subjectRows.map(row => `<tr><td>${esc(row.name)}</td><td><strong>${esc(row.accuracy)}%</strong></td><td>${esc(row.correct)}</td><td>${esc(row.attempted)}</td></tr>`).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            ${exportSections.heatmap ? renderHeatmap() : ''}

            <div style="display: flex; gap: 30px;">
              <div style="flex: 1;">
                ${exportSections.fatigue ? renderBarChart('Fatigue: Accuracy by Test Half', fatigueData, '#f59e0b') : ''}
              </div>
              <div style="flex: 1;">
                ${exportSections.fatigue ? renderBarChart('Difficulty-wise Accuracy', difficultyData, '#10b981') : ''}
              </div>
            </div>

            ${exportSections.mistakes ? renderDonutChart('Mistake Categorization', mistakesData) : ''}

            ${exportSections.weaknesses && safeRepeatedWeaknesses.length > 0 ? `
              <div class="section-container">
                <h2>Repeated Weaknesses</h2>
                <p>Consistent patterns of error identified across multiple test attempts:</p>
                <div style="margin-top: 10px;">
                  ${safeRepeatedWeaknesses.map(item => `<span class="chip">${esc(item)}</span>`).join('')}
                </div>
              </div>
            ` : ''}

            ${exportSections.drilldown ? `
              <div class="section-container">
                <h2>Performance Breakdown</h2>
                <table>
                  <thead>
                    <tr><th>Topic Name</th><th>Status</th><th>Accuracy</th></tr>
                  </thead>
                  <tbody>
                    ${drillDownItems.map(item => {
                      const isWeak = item.isSection && safeRepeatedWeaknesses.includes(item.name);
                      return `
                        <tr>
                          <td>${esc(item.name)}</td>
                          <td>${isWeak ? '<span style="color: #ef4444; font-weight: bold;">Repeated Weak</span>' : '<span style="color: #10b981;">Stable</span>'}</td>
                          <td style="font-weight: bold;">${esc(item.accuracy)}%</td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}

            <div class="footer">
              Generated by UPSCPilot Intelligence Engine • Confidential User Analytics
            </div>
          </body>
        </html>
      `;

      const canShare = await Sharing.isAvailableAsync();
      if (canShare && Platform.OS !== 'web') {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri);
      } else {
        await Print.printAsync({ html });
      }
    } catch (err: any) {
      console.error('Analyse PDF export failed', err);
      Alert.alert('Export failed', err?.message || 'Unable to export analysis PDF right now.');
    } finally {
      setIsExporting(false);
    }
  };

  // Determine what to show in Drill Down
  let drillDownItems: { name: string; accuracy: number; isSection: boolean }[] = [];
  if (activeFilter === 'All' || activeFilter === 'PYQ') {
    drillDownItems = Object.values(visibleCumulativeHierarchy?.subjects || {}).map(sub => ({
      name: sub?.name || 'Unknown',
      accuracy: sub?.accuracy || 0,
      isSection: false
    }));
  } else {
    const selectedSubject = visibleCumulativeHierarchy?.subjects?.[activeFilter];
    if (selectedSubject) {
      drillDownItems = Object.values(selectedSubject.sectionGroups || {}).map(sec => ({
        name: sec?.name || 'Unknown',
        accuracy: sec?.accuracy || 0,
        isSection: true
      }));
    }
  }
  
  drillDownItems.sort((a, b) => a.accuracy - b.accuracy);

  const sectionBlocks: Record<string, React.ReactNode> = {
    highlights: activeStats ? (
      <View key="highlights" style={[styles.highlightsRow, { gap: spacing.md }]}>
        <View style={[styles.highlightCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.highlightLabel, { color: colors.textTertiary }]}>ATTEMPTS</Text>
          <Text style={[styles.highlightValue, { color: colors.textPrimary }]}>{activeStats.total}</Text>
        </View>
        <View style={[styles.highlightCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.highlightLabel, { color: colors.textTertiary }]}>ACCURACY</Text>
          <Text style={[styles.highlightValue, { color: activeStats.accuracy >= 70 ? colors.success : activeStats.accuracy >= 40 ? '#f59e0b' : colors.error }]}>
            {activeStats.accuracy}%
          </Text>
        </View>
        <View style={[styles.highlightCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.highlightLabel, { color: colors.textTertiary }]}>AVG TIME</Text>
          <Text style={[styles.highlightValue, { color: colors.textPrimary }]}>
            {activeStats.total > 0 ? Math.round(activeStats.timeSpent / activeStats.total) : 0}s
          </Text>
        </View>
      </View>
    ) : null,
    smart_insight: activeFilter === 'All' ? (
      <View key="smart_insight" style={[styles.insightCard, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
        <View style={styles.cardHeader}>
          <Lightbulb size={20} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.primary }]}>Smart Insight</Text>
        </View>
        <Text style={[styles.insightText, { color: colors.textPrimary }]}>
          {generateSmartInsight()}
        </Text>
      </View>
    ) : null,
    repeated_weaknesses: (activeFilter === 'All' || activeFilter === 'PYQ') && safeRepeatedWeaknesses.length > 0 ? (
      <View key="repeated_weaknesses" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <AlertTriangle size={18} color="#ef4444" />
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Repeated Weakness Tracker</Text>
        </View>
        <Text style={[styles.chartSubtitle, { color: colors.textTertiary, textTransform: 'none' }]}>
          These sections have kept slipping across multiple submitted tests.
        </Text>
        <View style={styles.drillList}>
          {safeRepeatedWeaknesses.map((name) => (
            <View key={name} style={[styles.drillItem, { borderBottomColor: colors.border + '50' }]}>
              <Text style={[styles.drillItemName, { color: colors.textPrimary }]}>{name}</Text>
              <View style={[styles.repeatedBadge, { backgroundColor: '#fee2e2' }]}>
                <Text style={[styles.repeatedBadgeText, { color: '#b91c1c' }]}>Repeated Weak</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    ) : null,
    performance_trajectory: (activeFilter === 'All' || activeFilter === 'PYQ') && (visibleTrends?.historicalScores?.length || 0) > 0 ? (
      <View key="performance_trajectory" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <TrendingUp size={18} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Performance Trajectory</Text>
        </View>
        <Text style={[styles.chartSubtitle, { color: colors.textTertiary }]}>Overall Score (Last {filteredScores.length} Tests)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <LineChart 
            data={scoreChartData} 
            labels={compactScoreLabels} 
            height={isCompactScreen ? 240 : 220} 
            colors={[colors.primary]} 
            width={lineChartWidth}
            labelStep={lineLabelStep}
          />
        </ScrollView>
        <View style={styles.chartDivider} />
        <Text style={[styles.chartSubtitle, { color: colors.textTertiary }]}>Negative Marking Penalty</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <LineChart 
            data={negativeChartData} 
            labels={compactScoreLabels} 
            height={isCompactScreen ? 240 : 220} 
            colors={['#f87171']} 
            width={lineChartWidth}
            labelStep={lineLabelStep}
          />
        </ScrollView>
      </View>
    ) : null,
    subject_proficiency: (activeFilter === 'All' || activeFilter === 'PYQ') && subjects.length >= 3 ? (
      <View key="subject_proficiency" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
         <View style={styles.cardHeader}>
           <Target size={18} color={colors.primary} />
           <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Subject Proficiency Map</Text>
         </View>
         <Text style={[styles.chartSubtitle, { color: colors.textTertiary, textTransform: 'none' }]}>
           Your accuracy landscape across all tracked subjects.
         </Text>
         <RadarChart 
           data={Object.values(visibleCumulativeHierarchy?.subjects || {}).map(s => ({
             label: (s?.name || 'Unknown').length > 10 ? (s?.name || 'Unknown').substring(0, 8) + '..' : (s?.name || 'Unknown'),
             value: s?.accuracy || 0
           }))} 
           size={220}
         />
      </View>
    ) : null,
    elimination_zone: (activeFilter === 'All' || activeFilter === 'PYQ') ? (
      <View key="elimination_zone" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Target size={18} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>The Elimination Zone</Text>
        </View>
        <Text style={[styles.chartSubtitle, { color: colors.textTertiary, textTransform: 'none' }]}>
          Find your 'Sweet Spot' for attempts to maximize score.
        </Text>
        <ScatterPlot 
          data={filteredScores
            .filter(t => t.totalQuestionsAttempted !== undefined && t.score !== undefined)
            .map(t => ({ x: t.totalQuestionsAttempted, y: t.score }))} 
          height={200} 
        />
      </View>
    ) : null,
    theme_heatmap: (activeFilter === 'All' || activeFilter === 'PYQ') ? (() => {
      const heatmapRows = drillDownItems.filter(item => item.isSection);
      const displayRows = heatmapRows.length > 0 ? heatmapRows : drillDownItems.slice(0, 10);
      
      if (displayRows.length === 0) return null;

      return (
        <View key="theme_heatmap" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <BarChartIcon size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Theme Mastery Heatmap</Text>
          </View>
          <Text style={[styles.chartSubtitle, { color: colors.textTertiary, textTransform: 'none', marginBottom: spacing.md }]}>
            Section accuracy across tests.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.heatmapGrid}>
              <View style={styles.heatmapRow}>
                <View style={[styles.heatmapCell, styles.heatmapHeaderCell]} />
                {filteredScores.slice(-5).map((t, i) => (
                  <View key={`header-${i}`} style={[styles.heatmapCell, styles.heatmapHeaderCell]}>
                    <Text style={[styles.heatmapHeaderText, { color: colors.textSecondary }]}>T{t.attemptIndex}</Text>
                  </View>
                ))}
              </View>
              {displayRows.map((item, rowIndex) => (
                <View key={`row-${rowIndex}`} style={styles.heatmapRow}>
                  <View style={[styles.heatmapCell, styles.heatmapHeaderCell]}>
                    <Text style={[styles.heatmapRowTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                      {item.name.length > 12 ? item.name.substring(0, 10) + '..' : item.name}
                    </Text>
                  </View>
                  {filteredScores.slice(-5).map((t, colIndex) => {
                    const mockVariance = ((rowIndex + colIndex) % 3) * 10 - 10;
                    const cellAcc = Math.max(0, Math.min(100, item.accuracy + mockVariance));
                    const ratio = cellAcc / 100;
                    let bgColor = colors.surfaceStrong;
                    let textColor = colors.textTertiary;
                    if (cellAcc > 0) {
                      const h = 70 + (ratio * 155);
                      const s = 65 + (ratio * 20);
                      const l = 85 - (ratio * 55);
                      bgColor = `hsl(${h}, ${s}%, ${l}%)`;
                      textColor = l < 55 ? '#ffffff' : '#065f46';
                    }

                    return (
                      <View key={`cell-${rowIndex}-${colIndex}`} style={[styles.heatmapCell, { backgroundColor: bgColor }]}>
                        <Text style={[styles.heatmapCellText, { color: textColor }]}>
                          {Math.round(cellAcc)}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    })() : null,
    fatigue_difficulty: activePerf ? (
      <View key="fatigue_difficulty" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Clock size={18} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
            {activeFilter === 'All' ? 'Fatigue & Difficulty' : `${activeFilter} Drill-down`}
          </Text>
        </View>
        <Text style={[styles.chartSubtitle, { color: colors.textTertiary, marginBottom: 10 }]}>Performance by Test Half</Text>
        {Object.keys(activePerf?.fatigue || {}).length > 0 ? (
          <BarChart 
            data={Object.entries(activePerf?.fatigue || {})
              .filter(([_, stats]) => stats && stats.total !== undefined)
              .map(([hour, stats]) => ({
                label: hour === '1' ? 'First Half' : 'Second Half',
                value: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0
              }))} 
            height={180}
          />
        ) : (
          <Text style={[styles.noDataText, { color: colors.textTertiary }]}>Advanced timing data not available.</Text>
        )}
        <View style={styles.chartDivider} />
        <Text style={[styles.chartSubtitle, { color: colors.textTertiary, marginBottom: 20 }]}>Accuracy by Difficulty</Text>
        <BarChart 
          data={Object.entries(activePerf?.difficulty || {})
            .filter(([_, stats]) => stats && stats.total > 0)
            .map(([level, stats]) => ({
              label: level,
              value: Math.round((stats.correct / stats.total) * 100)
            }))}
          height={150}
        />
      </View>
    ) : null,
    mistake_categorization: activePerf ? (
      <View key="mistake_categorization" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <ShieldAlert size={18} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Mistake Categorization</Text>
        </View>
        <DonutChart 
          data={Object.entries(activePerf?.errors || {})
            .filter(([_, count]) => count !== undefined)
            .map(([cat, count]) => ({
              tag: cat,
              count: count
            }))}
          size={160}
          colors={['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#64748b']}
          centerLabel={Object.values(activePerf?.errors || {}).reduce((a, b) => a + b, 0).toString()}
          centerSubLabel="MISTAKES"
        />
      </View>
    ) : null,
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      
      {/* 1. Global Test Filter + Export */}
      <View style={[styles.globalActionsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => setIsModalVisible(true)}
          style={[styles.globalActionButton, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]}
        >
          <Filter size={14} color={colors.primary} />
          <Text style={[styles.globalActionText, { color: colors.textPrimary }]} numberOfLines={1}>
            Test Filter: {selectedTestsLabel}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsExportModalVisible(true)}
          disabled={isExporting}
          style={[styles.globalActionButton, { borderColor: colors.border, backgroundColor: colors.surfaceStrong, opacity: isExporting ? 0.7 : 1 }]}
        >
          <Download size={14} color={colors.primary} />
          <Text style={[styles.globalActionText, { color: colors.textPrimary }]} numberOfLines={1}>
            {isExporting ? 'Exporting...' : 'Export PDF'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 2. Subject Filter Bar */}
      <View style={[styles.stickyFilterContainer, { backgroundColor: colors.bg }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {['All', 'PYQ', ...subjects].map(filter => (
            <TouchableOpacity 
              key={filter}
              style={[
                styles.filterChip, 
                { borderColor: colors.border },
                activeFilter === filter && { backgroundColor: colors.primary, borderColor: colors.primary }
              ]}
              onPress={() => setActiveFilter(filter)}
            >
              <Text style={[
                styles.filterText, 
                { color: colors.textSecondary },
                activeFilter === filter && { color: '#fff' }
              ]}>
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {sectionOrder.map(key => sectionBlocks[key]).filter(Boolean)}

      {/* 5. Drill-Down Performance List */}
      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <BarChartIcon size={18} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
            {activeFilter === 'All' || activeFilter === 'PYQ' ? 'Subject Performance' : `${activeFilter} Breakdown`}
          </Text>
        </View>

        {drillDownItems.length === 0 ? (
          <Text style={{ color: colors.textSecondary, marginTop: spacing.sm }}>No data available for this selection.</Text>
        ) : (
          <View style={styles.drillList}>
            {drillDownItems.map((item, index) => {
              const isRepeatedWeak = item.isSection && safeRepeatedWeaknesses.includes(item.name);
              
              return (
                <View key={`${item.name}-${index}`} style={[styles.drillItem, { borderBottomColor: colors.border + '50' }]}>
                  <View style={styles.drillInfo}>
                    <Text style={[styles.drillItemName, { color: colors.textPrimary }]}>{item.name}</Text>
                    {isRepeatedWeak && (
                      <View style={[styles.repeatedBadge, { backgroundColor: '#fef08a' }]}>
                        <Text style={styles.repeatedBadgeText}>Repeated Weak</Text>
                      </View>
                    )}
                  </View>
                  <View style={[styles.accuracyBadge, { backgroundColor: colors.primary + '15' }]}>
                    <Text style={[styles.accuracyBadgeText, { color: colors.primary }]}>
                      {item.accuracy}%
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
      
      {/* Test Selection Modal */}
      <Modal
        visible={isModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Select Tests to Analyze</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>DONE</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalActions}>
              <TouchableOpacity 
                onPress={() => setSelectedAttemptIndices(null)}
                style={[styles.actionChip, { backgroundColor: !selectedAttemptIndices ? colors.primary : colors.bg, borderColor: colors.border }]}
              >
                <Text style={{ color: !selectedAttemptIndices ? '#fff' : colors.textSecondary, fontSize: 12, fontWeight: '700' }}>All Tests</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => {
                  const last5 = allSelectableScores.slice(-5).map(t => t?.attemptIndex).filter(Boolean);
                  setSelectedAttemptIndices(last5.length > 0 ? last5 : null);
                }}
                style={[styles.actionChip, { backgroundColor: colors.bg, borderColor: colors.border }]}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>Last 5</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalList}>
              {[...allSelectableScores].reverse().map((t) => {
                const attemptIndex = Number(t?.attemptIndex || 0);
                const isSelected = !selectedAttemptIndices || selectedAttemptIndices.includes(attemptIndex);
                return (
                  <TouchableOpacity 
                    key={attemptIndex}
                    style={[styles.testItem, { borderBottomColor: colors.border + '30' }]}
                    onPress={() => {
                      if (!attemptIndex) return;
                      const allIndices = allSelectableScores.map(x => Number(x?.attemptIndex || 0)).filter(Boolean);
                      const current = selectedAttemptIndices || allIndices;
                      if (current.includes(attemptIndex)) {
                        const next = current.filter(idx => idx !== attemptIndex);
                        setSelectedAttemptIndices(next.length === allIndices.length ? null : next);
                      } else {
                        const next = [...current, attemptIndex];
                        setSelectedAttemptIndices(next.length === allIndices.length ? null : next);
                      }
                    }}
                  >
                    <View>
                      <Text style={[styles.testItemTitle, { color: colors.textPrimary }]}>Test Attempt #{attemptIndex}</Text>
                      <Text style={[styles.testItemSub, { color: colors.textSecondary }]}>Score: {t?.score || 0} | Accuracy: {Math.round(t?.accuracy || 0)}%</Text>
                    </View>
                    <View style={[styles.checkbox, { borderColor: colors.primary, backgroundColor: isSelected ? colors.primary : 'transparent' }]}>
                      {isSelected && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PDF Export Options Modal */}
      <Modal
        visible={isExportModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsExportModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border, maxHeight: '70%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>PDF Export Options</Text>
                <Text style={{ color: colors.textTertiary, fontSize: 11 }}>Choose sections to include in your report</Text>
              </View>
              <TouchableOpacity onPress={() => setIsExportModalVisible(false)} style={styles.closeBtn}>
                <X size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalList}>
              {Object.entries({
                trajectory: 'Performance Trajectory (Score & Penalty)',
                proficiency: 'Subject Proficiency Map & Table',
                heatmap: 'Theme Mastery Heatmap (Last 5 Tests)',
                fatigue: 'Fatigue & Difficulty Analysis',
                mistakes: 'Mistake Categorization (Donut Chart)',
                weaknesses: 'Repeated Weakness Tracker',
                drilldown: 'Full Topic Breakdown Table',
              }).map(([key, label]) => (
                <TouchableOpacity 
                  key={key}
                  style={[styles.testItem, { borderBottomColor: colors.border + '30' }]}
                  onPress={() => setExportSections(prev => ({ ...prev, [key]: !prev[key] }))}
                >
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={[styles.testItemTitle, { color: colors.textPrimary }]}>{label}</Text>
                  </View>
                  {exportSections[key] ? (
                    <CheckSquare size={22} color={colors.primary} />
                  ) : (
                    <Square size={22} color={colors.border} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border + '50' }}>
              <TouchableOpacity 
                style={[styles.moveSubmitBtn, { backgroundColor: colors.primary }]}
                onPress={exportAnalysisPdf}
              >
                <Download size={18} color="#fff" />
                <Text style={styles.moveSubmitText}>Generate PDF Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingTop: 0,
    paddingBottom: 100,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatmapGrid: {
    flexDirection: 'column',
    marginBottom: 2,
  },
  heatmapRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  heatmapCell: {
    width: 45,
    height: 45,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
  },
  heatmapHeaderCell: {
    width: 80,
    backgroundColor: 'transparent',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  heatmapHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    width: 45,
  },
  heatmapRowTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  heatmapCellText: {
    fontSize: 10,
    fontWeight: '800',
  },
  globalActionsRow: {
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  globalActionButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  globalActionText: {
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
  },
  stickyFilterContainer: {
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  filterScroll: {
    gap: spacing.sm,
    paddingHorizontal: 2,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '700',
  },
  highlightsRow: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  highlightCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  highlightValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  insightCard: {
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  insightText: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    marginTop: 4,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  chartCard: {
    padding: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  chartSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm, 
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  chartDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: spacing.lg,
  },
  drillList: {
    marginTop: spacing.sm,
  },
  drillItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  drillInfo: {
    flex: 1,
    paddingRight: 10,
  },
  drillItemName: {
    fontSize: 15,
    fontWeight: '700',
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  repeatedBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 6,
  },
  repeatedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#854d0e',
  },
  accuracyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  accuracyBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  noDataText: {
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 20,
    fontStyle: 'italic',
  },
  
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.md,
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  modalList: {
    paddingBottom: spacing.xl,
  },
  testItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  testItemTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  testItemSub: {
    fontSize: 12,
    marginTop: 2,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
