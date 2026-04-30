cd /path/to/frontend2.2   # must be the repo: upsc-serv-1/frontend2.2 (branch 2.2-cto)

cat > analyse-fix.patch <<'PATCH'
diff --git a/src/components/unified/AnalyseSection.tsx b/src/components/unified/AnalyseSection.tsx
index b962779..7c058f0 100644
--- a/src/components/unified/AnalyseSection.tsx
+++ b/src/components/unified/AnalyseSection.tsx
@@ -1,10 +1,12 @@
 import React, { useEffect, useState, useMemo } from 'react';
-import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Dimensions, Modal, FlatList } from 'react-native';
+import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Dimensions, Modal, Alert, Platform } from 'react-native';
+import * as Print from 'expo-print';
+import * as Sharing from 'expo-sharing';
 import { useTheme } from '../../context/ThemeContext';
 import { spacing, radius } from '../../theme';
 import { useAggregateTestAnalytics } from '../../hooks/useTestAnalytics';
 import { LineChart, RadarChart, BarChart, DonutChart, ScatterPlot } from '../Charts';
-import { AlertTriangle, TrendingUp, Filter, Lightbulb, Clock, ShieldAlert, BarChart2 as BarChartIcon, Target } from 'lucide-react-native';
+import { AlertTriangle, TrendingUp, Filter, Lightbulb, Clock, ShieldAlert, BarChart2 as BarChartIcon, Target, Download } from 'lucide-react-native';
 import { DEFAULT_ANALYTICS_LAYOUT, loadAnalyticsLayout } from '../../utils/analyticsLayout';
 import {
   buildAggregateHierarchicalAccuracy,
@@ -24,7 +26,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
     trends,
     cumulativeHierarchy,
     repeatedWeaknesses,
-    rawAllQuestions,
+    allQuestions,
     rawAttemptsForTrend,
   } = useAggregateTestAnalytics(userId);
   
@@ -35,6 +37,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
   const [sectionOrder, setSectionOrder] = useState<string[]>(DEFAULT_ANALYTICS_LAYOUT.overall);
   const [selectedAttemptIndices, setSelectedAttemptIndices] = useState<number[] | null>(null);
   const [isModalVisible, setIsModalVisible] = useState(false);
+  const [isExporting, setIsExporting] = useState(false);
 
   useEffect(() => {
     loadAnalyticsLayout().then(layout => {
@@ -50,7 +53,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
 
   const filteredAggregate = useMemo(() => {
     const safeAttempts = rawAttemptsForTrend || [];
-    const safeQuestions = rawAllQuestions || [];
+    const safeQuestions = allQuestions || [];
 
     if (safeAttempts.length === 0 || safeQuestions.length === 0) {
       return null;
@@ -79,7 +82,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
       cumulativeHierarchy: filteredCumulativeHierarchy,
       repeatedWeaknesses: filteredRepeatedWeaknesses,
     };
-  }, [rawAllQuestions, rawAttemptsForTrend, selectedAttemptIndices]);
+  }, [allQuestions, rawAttemptsForTrend, selectedAttemptIndices]);
 
   const selectableTrends = useMemo(() => {
     if ((rawAttemptsForTrend?.length || 0) > 0) {
@@ -194,6 +197,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
   const filteredScores = visibleTrends?.historicalScores || [];
   const filteredNegatives = visibleTrends?.negativeMarkingTrends || [];
   const allSelectableScores = selectableTrends?.historicalScores || [];
+  const safeRepeatedWeaknesses = visibleRepeatedWeaknesses || [];
 
   const scoreChartData = [{
     label: 'Overall Score',
@@ -206,10 +210,121 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
     values: filteredNegatives.map(t => t?.negativeMarksPenalty || 0)
   }];
 
+  const selectedTestsLabel = selectedAttemptIndices?.length
+    ? `${selectedAttemptIndices.length} Selected`
+    : 'All Tests';
+
   const lineLabelStep = scoreLabels.length > 18 ? 3 : scoreLabels.length > 11 ? 2 : 1;
   const lineChartWidth = Math.max(screenWidth - spacing.lg * 4, scoreLabels.length * (isCompactScreen ? 56 : 48));
   const compactScoreLabels = filteredScores.map(t => `T${t?.attemptIndex}`);
 
+  const exportAnalysisPdf = async () => {
+    if (isExporting) return;
+
+    try {
+      setIsExporting(true);
+
+      const esc = (value: string | number) => String(value ?? '')
+        .replace(/&/g, '&amp;')
+        .replace(/</g, '&lt;')
+        .replace(/>/g, '&gt;')
+        .replace(/"/g, '&quot;')
+        .replace(/'/g, '&#39;');
+
+      const renderSimpleLine = (title: string, labels: string[], values: number[], color: string) => {
+        if (!labels.length || !values.length) return '';
+        const widthSvg = 960;
+        const heightSvg = 300;
+        const left = 56;
+        const right = 24;
+        const top = 20;
+        const bottom = 48;
+        const plotW = widthSvg - left - right;
+        const plotH = heightSvg - top - bottom;
+        const max = Math.max(...values, 1);
+        const x = (i: number) => left + (labels.length === 1 ? 0 : (i * plotW) / (labels.length - 1));
+        const y = (v: number) => top + plotH - (v / max) * plotH;
+        const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
+        const xLabels = labels.map((label, i) => `<text x="${x(i)}" y="${heightSvg - 14}" text-anchor="middle" font-size="10" fill="#475569">${esc(label)}</text>`).join('');
+
+        return `
+          <h2>${esc(title)}</h2>
+          <div class="chart-card">
+            <svg viewBox="0 0 ${widthSvg} ${heightSvg}" width="100%" height="${heightSvg}">
+              <rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="#fff" stroke="#e2e8f0" />
+              <polyline fill="none" stroke="${color}" stroke-width="3" points="${points}" />
+              ${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}" />`).join('')}
+              ${xLabels}
+            </svg>
+          </div>
+        `;
+      };
+
+      const subjectRows = Object.values(visibleCumulativeHierarchy?.subjects || {})
+        .map(subject => ({
+          name: subject?.name || 'Unknown',
+          accuracy: subject?.accuracy || 0,
+          attempted: (subject?.correct || 0) + (subject?.incorrect || 0),
+          correct: subject?.correct || 0,
+        }))
+        .sort((a, b) => b.accuracy - a.accuracy);
+
+      const scoreLabelsPdf = filteredScores.map(item => `T${item?.attemptIndex || ''}`);
+      const scoreValuesPdf = filteredScores.map(item => item?.score || 0);
+      const negativeValuesPdf = filteredNegatives.map(item => item?.negativeMarksPenalty || 0);
+
+      const html = `
+        <html>
+          <head>
+            <meta charset="utf-8" />
+            <style>
+              body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
+              h1 { margin: 0 0 8px; font-size: 24px; }
+              h2 { margin: 18px 0 8px; font-size: 16px; color: #1e293b; }
+              p { margin: 0 0 10px; font-size: 12px; color: #475569; }
+              table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
+              th, td { border: 1px solid #d1d5db; padding: 6px; font-size: 11px; }
+              th { background: #f8fafc; text-align: left; }
+              .chart-card { border: 1px solid #d1d5db; border-radius: 12px; padding: 8px; margin-bottom: 14px; }
+              .chip { display: inline-block; margin: 2px 4px 2px 0; background: #fee2e2; color: #991b1b; border-radius: 999px; padding: 4px 10px; font-size: 10px; font-weight: 700; }
+              .muted { color: #64748b; }
+            </style>
+          </head>
+          <body>
+            <h1>Analyse Report</h1>
+            <p>Exported on ${esc(new Date().toLocaleString())}</p>
+            <p>Scope: ${esc(activeFilter)} • Test Filter: ${esc(selectedTestsLabel)} • Tests Included: ${esc(filteredScores.length)}</p>
+
+            ${renderSimpleLine('Overall Score Trajectory', scoreLabelsPdf, scoreValuesPdf, '#2563eb')}
+            ${renderSimpleLine('Negative Marking Penalty', scoreLabelsPdf, negativeValuesPdf, '#dc2626')}
+
+            <h2>Subject Proficiency</h2>
+            <table>
+              <tr><th>Subject</th><th>Accuracy</th><th>Correct</th><th>Attempted</th></tr>
+              ${subjectRows.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.accuracy)}%</td><td>${esc(row.correct)}</td><td>${esc(row.attempted)}</td></tr>`).join('')}
+            </table>
+
+            <h2>Repeated Weaknesses</h2>
+            ${safeRepeatedWeaknesses.length > 0 ? safeRepeatedWeaknesses.map(item => `<span class="chip">${esc(item)}</span>`).join('') : '<p class="muted">No repeated weaknesses in current filter scope.</p>'}
+          </body>
+        </html>
+      `;
+
+      const canShare = await Sharing.isAvailableAsync();
+      if (canShare && Platform.OS !== 'web') {
+        const { uri } = await Print.printToFileAsync({ html });
+        await Sharing.shareAsync(uri);
+      } else {
+        await Print.printAsync({ html });
+      }
+    } catch (err: any) {
+      console.error('Analyse PDF export failed', err);
+      Alert.alert('Export failed', err?.message || 'Unable to export analysis PDF right now.');
+    } finally {
+      setIsExporting(false);
+    }
+  };
+
   // Determine what to show in Drill Down
   let drillDownItems: { name: string; accuracy: number; isSection: boolean }[] = [];
   if (activeFilter === 'All' || activeFilter === 'PYQ') {
@@ -263,7 +378,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
         </Text>
       </View>
     ) : null,
-    repeated_weaknesses: (activeFilter === 'All' || activeFilter === 'PYQ') && visibleRepeatedWeaknesses.length > 0 ? (
+    repeated_weaknesses: (activeFilter === 'All' || activeFilter === 'PYQ') && safeRepeatedWeaknesses.length > 0 ? (
       <View key="repeated_weaknesses" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
         <View style={styles.cardHeader}>
           <AlertTriangle size={18} color="#ef4444" />
@@ -273,7 +388,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
           These sections have kept slipping across multiple submitted tests.
         </Text>
         <View style={styles.drillList}>
-          {visibleRepeatedWeaknesses.map((name) => (
+          {safeRepeatedWeaknesses.map((name) => (
             <View key={name} style={[styles.drillItem, { borderBottomColor: colors.border + '50' }]}>
               <Text style={[styles.drillItemName, { color: colors.textPrimary }]}>{name}</Text>
               <View style={[styles.repeatedBadge, { backgroundColor: '#fee2e2' }]}>
@@ -286,20 +401,9 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
     ) : null,
     performance_trajectory: (activeFilter === 'All' || activeFilter === 'PYQ') && (visibleTrends?.historicalScores?.length || 0) > 0 ? (
       <View key="performance_trajectory" style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
-        <View style={[styles.cardHeader, { justifyContent: 'space-between' }]}>
-          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
-            <TrendingUp size={18} color={colors.primary} />
-            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Performance Trajectory</Text>
-          </View>
-          <TouchableOpacity 
-            onPress={() => setIsModalVisible(true)}
-            style={[styles.filterButton, { backgroundColor: colors.primary + '15' }]}
-          >
-            <Filter size={14} color={colors.primary} />
-            <Text style={[styles.filterButtonText, { color: colors.primary }]}>
-              {selectedAttemptIndices ? `${selectedAttemptIndices.length} Tests` : 'Filter'}
-            </Text>
-          </TouchableOpacity>
+        <View style={styles.cardHeader}>
+          <TrendingUp size={18} color={colors.primary} />
+          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Performance Trajectory</Text>
         </View>
         <Text style={[styles.chartSubtitle, { color: colors.textTertiary }]}>Overall Score (Last {filteredScores.length} Tests)</Text>
         <ScrollView horizontal showsHorizontalScrollIndicator={false}>
@@ -423,9 +527,9 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
           </Text>
         </View>
         <Text style={[styles.chartSubtitle, { color: colors.textTertiary, marginBottom: 10 }]}>Performance by Test Half</Text>
-        {Object.keys(activePerf.fatigue || {}).length > 0 ? (
+        {Object.keys(activePerf?.fatigue || {}).length > 0 ? (
           <BarChart 
-            data={Object.entries(activePerf.fatigue || {})
+            data={Object.entries(activePerf?.fatigue || {})
               .filter(([_, stats]) => stats && stats.total !== undefined)
               .map(([hour, stats]) => ({
                 label: hour === '1' ? 'First Half' : 'Second Half',
@@ -439,7 +543,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
         <View style={styles.chartDivider} />
         <Text style={[styles.chartSubtitle, { color: colors.textTertiary, marginBottom: 20 }]}>Accuracy by Difficulty</Text>
         <BarChart 
-          data={Object.entries(activePerf.difficulty || {})
+          data={Object.entries(activePerf?.difficulty || {})
             .filter(([_, stats]) => stats && stats.total > 0)
             .map(([level, stats]) => ({
               label: level,
@@ -456,7 +560,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
           <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Mistake Categorization</Text>
         </View>
         <DonutChart 
-          data={Object.entries(activePerf.errors || {})
+          data={Object.entries(activePerf?.errors || {})
             .filter(([_, count]) => count !== undefined)
             .map(([cat, count]) => ({
               tag: cat,
@@ -464,7 +568,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
             }))}
           size={160}
           colors={['#ef4444', '#f59e0b', '#3b82f6', '#8b5cf6', '#64748b']}
-          centerLabel={Object.values(activePerf.errors).reduce((a, b) => a + b, 0).toString()}
+          centerLabel={Object.values(activePerf?.errors || {}).reduce((a, b) => a + b, 0).toString()}
           centerSubLabel="MISTAKES"
         />
       </View>
@@ -474,7 +578,31 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
   return (
     <ScrollView contentContainerStyle={styles.container}>
       
-      {/* 1. Sticky Filter Bar */}
+      {/* 1. Global Test Filter + Export */}
+      <View style={[styles.globalActionsRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
+        <TouchableOpacity
+          onPress={() => setIsModalVisible(true)}
+          style={[styles.globalActionButton, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }]}
+        >
+          <Filter size={14} color={colors.primary} />
+          <Text style={[styles.globalActionText, { color: colors.textPrimary }]} numberOfLines={1}>
+            Test Filter: {selectedTestsLabel}
+          </Text>
+        </TouchableOpacity>
+
+        <TouchableOpacity
+          onPress={exportAnalysisPdf}
+          disabled={isExporting}
+          style={[styles.globalActionButton, { borderColor: colors.border, backgroundColor: colors.surfaceStrong, opacity: isExporting ? 0.7 : 1 }]}
+        >
+          <Download size={14} color={colors.primary} />
+          <Text style={[styles.globalActionText, { color: colors.textPrimary }]} numberOfLines={1}>
+            {isExporting ? 'Exporting...' : 'Export PDF'}
+          </Text>
+        </TouchableOpacity>
+      </View>
+
+      {/* 2. Subject Filter Bar */}
       <View style={[styles.stickyFilterContainer, { backgroundColor: colors.bg }]}>
         <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
           {['All', 'PYQ', ...subjects].map(filter => (
@@ -515,7 +643,7 @@ export const AnalyseSection = ({ userId }: AnalyseSectionProps) => {
         ) : (
           <View style={styles.drillList}>
             {drillDownItems.map((item, index) => {
-              const isRepeatedWeak = item.isSection && visibleRepeatedWeaknesses.includes(item.name);
+              const isRepeatedWeak = item.isSection && safeRepeatedWeaknesses.includes(item.name);
               
               return (
                 <View key={`${item.name}-${index}`} style={[styles.drillItem, { borderBottomColor: colors.border + '50' }]}>
@@ -658,11 +786,31 @@ const styles = StyleSheet.create({
     fontSize: 10,
     fontWeight: '800',
   },
+  globalActionsRow: {
+    borderWidth: 1,
+    borderRadius: 16,
+    padding: spacing.sm,
+    marginTop: spacing.md,
+    marginBottom: spacing.sm,
+    gap: spacing.sm,
+  },
+  globalActionButton: {
+    borderWidth: 1,
+    borderRadius: 12,
+    paddingHorizontal: 12,
+    paddingVertical: 10,
+    flexDirection: 'row',
+    alignItems: 'center',
+    gap: 8,
+  },
+  globalActionText: {
+    fontSize: 12,
+    fontWeight: '800',
+    flex: 1,
+  },
   stickyFilterContainer: {
     paddingVertical: spacing.md,
     marginBottom: spacing.sm,
-    // Note: To make it truly sticky, the parent layout usually implements stickyHeaderIndices.
-    // For this standalone component, it stays visually sticky if placed correctly in the screen.
   },
   filterScroll: {
     gap: spacing.sm,
@@ -796,18 +944,7 @@ const styles = StyleSheet.create({
     marginVertical: 20,
     fontStyle: 'italic',
   },
-  filterButton: {
-    flexDirection: 'row',
-    alignItems: 'center',
-    paddingHorizontal: 10,
-    paddingVertical: 6,
-    borderRadius: 8,
-    gap: 4,
-  },
-  filterButtonText: {
-    fontSize: 12,
-    fontWeight: '800',
-  },
+  
   modalOverlay: {
     flex: 1,
     backgroundColor: 'rgba(0,0,0,0.5)',
diff --git a/src/hooks/useTestAnalytics.ts b/src/hooks/useTestAnalytics.ts
index fd3b8d9..218fe5a 100644
--- a/src/hooks/useTestAnalytics.ts
+++ b/src/hooks/useTestAnalytics.ts
@@ -364,6 +364,7 @@ export function useAggregateTestAnalytics(userId: string | null) {
     trends,
     cumulativeHierarchy,
     repeatedWeaknesses,
+    allQuestions: rawAllQuestions,
     rawAllQuestions,
     rawAttemptsForTrend,
   };
PATCH

git apply analyse-fix.patch
npx tsc --noEmit