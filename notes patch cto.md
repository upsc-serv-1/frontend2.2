
    Exact code edits (clear patch-style snippets)

A) app/notes/index.tsx — replace broken drag interactions with reliable long-press + destination picker
A1. Add folder action state + helper
diff

@@
- const [actionNote, setActionNote] = useState<PilotNoteNode | null>(null);
+ const [actionNote, setActionNote] = useState<PilotNoteNode | null>(null);
+ const [folderActionTarget, setFolderActionTarget] = useState<any | null>(null);

@@
 const openMovePicker = (target: any) => {
   setMoveTarget(target);
   setTargetFolderId(null);
   setMoveNoteVisible(true);
 };

+const openFolderActions = (folder: any) => {
+  Vibration.vibrate(40);
+  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
+  setFolderActionTarget(folder);
+};

A2. Build destination folder list recursively (supports nested folder moves; excludes self + descendants)
diff

@@
+const descendantIds = useMemo(() => {
+  const ids = new Set<string>();
+  const startId = moveTarget?.id;
+  if (!startId || !vaultData?.allFolders) return ids;
+  const collectChildren = (parentId: string) => {
+    Object.values(vaultData.allFolders || {}).forEach((folder: any) => {
+      if (folder?.parentId === parentId && folder?.id) {
+        ids.add(folder.id);
+        collectChildren(folder.id);
+      }
+    });
+  };
+  collectChildren(startId);
+  return ids;
+}, [moveTarget, vaultData?.allFolders]);
+
+const destinationFolders = useMemo(() => {
+  const allFolders = vaultData?.allFolders || {};
+  const rows: Array<{ id: string; name: string; depth: number; parentId: string | null }> = [];
+  const walk = (parentId: string | null, depth: number) => {
+    const children = Object.values(allFolders)
+      .filter((folder: any) => (folder?.parentId ?? null) === parentId)
+      .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
+    children.forEach((folder: any) => {
+      if (!folder?.id || folder.id === moveTarget?.id || descendantIds.has(folder.id)) return;
+      rows.push({ id: folder.id, name: folder.name || 'Untitled', depth, parentId: folder.parentId ?? null });
+      walk(folder.id, depth + 1);
+    });
+  };
+  walk(null, 0);
+  return rows;
+}, [vaultData?.allFolders, moveTarget, descendantIds]);

A3. Remove drag/pan behavior from note/folder cards; use long press to open move flow

(Apply same pattern to DraggableNoteCard, TreeSection, TreeMicroTopic, SubjectCard)
diff

@@ DraggableNoteCard
-<GestureDetector gesture={composedGesture}>
-  <ReAnimated.View ...>
+<TouchableOpacity
+  activeOpacity={0.85}
+  onPress={() => router.push({ pathname: '/notes/editor', params: { id: note.note_id, title: note.title, subject: note.subject } })}
+  onLongPress={() => openMovePicker(note)}
+>
+  <View ...>
...
-  </ReAnimated.View>
-</GestureDetector>
+  </View>
+</TouchableOpacity>

diff

@@ TreeSection / TreeMicroTopic / SubjectCard long press
- onLongPress={() => { Alert.alert(... Move Folder ...); }}
+ onLongPress={() => openFolderActions(section /* or topic / subject */)}

A4. Fix modal touch layering (removes transparent/non-clickable behavior)
diff

@@ move modal
-<View style={styles.modalOverlay}>
-  <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} onPress={...} />
-  <View style={[styles.actionSheet, ...]}>
+<Pressable
+  style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
+  onPress={() => { setMoveNoteVisible(false); setTargetFolderId(null); }}
+>
+  <Pressable style={[styles.actionSheet, ...]} onPress={() => {}}>

A5. Use recursive destinationFolders in picker
diff

@@
-{(() => { /* old fixed 3-level folder builder */ })()}
+{destinationFolders.map((folder) => {
+  const isSelected = targetFolderId === folder.id;
+  const depthColors = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6'];
+  const accentColor = depthColors[folder.depth] || colors.primary;
+  return (
+    <TouchableOpacity key={folder.id} ... onPress={() => setTargetFolderId(folder.id)}>
+      ...
+    </TouchableOpacity>
+  );
+})}
+{destinationFolders.length === 0 && (
+  <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
+    No valid destination folders available.
+  </Text>
+)}

A6. Add folder action modal (Move/Rename/Delete) instead of brittle Alert menu
diff

+<Modal visible={!!folderActionTarget} transparent animationType="fade" onRequestClose={() => setFolderActionTarget(null)}>
+  <Pressable style={styles.modalOverlay} onPress={() => setFolderActionTarget(null)}>
+    <RNAnimated.View style={[styles.actionSheet, { backgroundColor: colors.surface }]} onStartShouldSetResponder={() => true}>
+      ...
+      <TouchableOpacity onPress={() => { const t = folderActionTarget; setFolderActionTarget(null); if (t) openMovePicker(t); }}>
+        <Text>Move Folder</Text>
+      </TouchableOpacity>
+      ...
+    </RNAnimated.View>
+  </Pressable>
+</Modal>

A7. Add style
diff

+emptyHint: {
+  fontSize: 12,
+  fontWeight: '600',
+  marginTop: 6,
+  marginBottom: 2,
+},

B) src/components/RichNoteEditor.tsx — multi-color highlight + explicit unhighlight
diff

@@
-import { Eraser, Highlighter } from 'lucide-react-native';
+import { Eraser, Highlighter, Palette } from 'lucide-react-native';

@@
 const HIGHLIGHT_COLORS = [
   'transparent',
@@
 ];

@@
-const applyHighlight = () => {
-  editorRef.current?.commandDOM(
-    `document.execCommand('backColor', false, '${highlightColor}')`
-  );
-};
+const applyHighlight = (selectedColor?: string) => {
+  const color = selectedColor ?? highlightColor;
+  if (color === 'transparent') {
+    editorRef.current?.commandDOM(`
+      (function() {
+        document.execCommand('hiliteColor', false, 'transparent');
+        document.execCommand('backColor', false, 'transparent');
+        const nodes = document.querySelectorAll('mark, span, font');
+        nodes.forEach((node) => {
+          const bg = (node.style && node.style.backgroundColor ? node.style.backgroundColor : '').toLowerCase();
+          if (node.tagName === 'MARK' || bg.includes('transparent') || bg === 'rgba(0, 0, 0, 0)') {
+            const p = node.parentNode;
+            while (node.firstChild) p.insertBefore(node.firstChild, node);
+            p.removeChild(node);
+          }
+        });
+      })();
+    `);
+    return;
+  }
+  editorRef.current?.commandDOM(
+    `document.execCommand('hiliteColor', false, '${color}'); document.execCommand('backColor', false, '${color}');`
+  );
+};

@@
-const pickColor = async (c: string) => {
+const pickColor = async (c: string) => {
   setHighlightColor(c);
   await AsyncStorage.setItem(DEFAULT_COLOR_KEY, c);
   setShowPicker(false);
-  applyHighlight();
+  applyHighlight(c);
 };

@@ toolbar actions
-  'highlight',
+  'highlight_apply',
+  'highlight_picker',
+  'highlight_clear',

@@ iconMap
-  highlight: ({ tintColor }: any) => (
-    <TouchableOpacity onLongPress={() => setShowPicker(v => !v)} onPress={applyHighlight}>
+  highlight_apply: ({ tintColor }: any) => (
+    <TouchableOpacity onPress={() => applyHighlight(highlightColor)}>
       <View style={[s.hlIcon, { backgroundColor: highlightColor }]}>
         <Highlighter size={16} color={tintColor} />
       </View>
     </TouchableOpacity>
   ),
+  highlight_picker: ({ tintColor }: any) => (
+    <TouchableOpacity onPress={() => setShowPicker(v => !v)}>
+      <View style={s.toolIcon}>
+        <Palette size={16} color={tintColor} />
+      </View>
+    </TouchableOpacity>
+  ),
+  highlight_clear: ({ tintColor }: any) => (
+    <TouchableOpacity onPress={() => applyHighlight('transparent')}>
+      <View style={s.toolIcon}>
+        <Eraser size={16} color={tintColor} />
+      </View>
+    </TouchableOpacity>
+  ),

@@ picker swatch
- style={[s.swatch, { backgroundColor: c, borderColor: c === highlightColor ? themeColors.primary : 'transparent' }]} />
+ style={[s.swatch, {
+   backgroundColor: c === 'transparent' ? themeColors.surface : c,
+   borderColor: c === highlightColor ? themeColors.primary : themeColors.border
+ }]}
+>
+  {c === 'transparent' ? <Eraser size={12} color={themeColors.textPrimary} /> : null}
+</TouchableOpacity>

@@ styles
+toolIcon: { padding: 6, borderRadius: 6 },

C) app/notes/editor.tsx — make underline/highlight visible in reading mode
diff

@@ normalizeEditorHtml
 const normalizeEditorHtml = (txt: string) => {
   if (!txt) return '';
   return txt
-    .replace(/<span[^>]*text-decoration\s*:\s*underline;?[^>]*>(.*?)<\/span>/gi, '<u>$1</u>')
-    .replace(/<span[^>]*background-color\s*:\s*([^;"']+)[^>]*>(.*?)<\/span>/gi, '<mark style="background-color:$1">$2</mark>');
+    .replace(/<span[^>]*text-decoration(?:-line)?\s*:\s*underline;?[^>]*>([\s\S]*?)<\/span>/gi, '<u>$1</u>')
+    .replace(/<font[^>]*style=['"][^'"]*background-color\s*:\s*([^;'" ]+)[^'"]*['"][^>]*>([\s\S]*?)<\/font>/gi, '<mark style="background-color:$1">$2</mark>')
+    .replace(/<span[^>]*style=['"][^'"]*background-color\s*:\s*([^;'" ]+)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/gi, '<mark style="background-color:$1">$2</mark>');
 };

@@ htmlStyles
 const htmlStyles = {
   b: { fontWeight: 'bold' as const, color: colors.textPrimary },
   strong: { fontWeight: 'bold' as const, color: colors.textPrimary },
   i: { fontStyle: 'italic' as const },
   em: { fontStyle: 'italic' as const },
-  u: { textDecorationLine: 'underline' as const },
+  u: { textDecorationLine: 'underline' as const, textDecorationColor: colors.textPrimary, textDecorationStyle: 'solid' as const },
   ins: { textDecorationLine: 'underline' as const },
-  mark: { backgroundColor: '#FFF59D', color: '#000' },
+  span: { color: colors.textPrimary },
+  mark: { backgroundColor: '#FFF59D', color: colors.textPrimary, paddingHorizontal: 2 },
 };

    Verification steps

    Open Notes Pro in phone/small screen.
    Long-press any folder (root or nested) → folder action sheet appears (not transparent).
    Tap Move Folder → destination picker opens.
    Pick nested folder and tap Confirm Move; verify folder moves.
    Move folder to Main Dashboard (Root) and verify.
    Long-press note card → move picker opens; move note into subfolder and verify.
    In note editor, select text:
        Apply underline and highlight colors; verify visible in reading mode preview.
        Use palette button and pick different colors.
        Tap erase/unhighlight action; verify highlight removed.
    Regression: exported PDF still preserves formatting.

    Final copy-paste command block for Gemini to implement

text

Apply a targeted fix in THREE files only:

1) app/notes/index.tsx
2) src/components/RichNoteEditor.tsx
3) app/notes/editor.tsx

Requirements:
- Remove/disable broken gesture-based drag flow in Notes Pro and replace with reliable long-press move workflow.
- Folder long-press must open a proper action sheet modal (Move/Rename/Delete), not Alert.
- Move destination picker must support recursive nested folders (not fixed 2-3 levels), exclude self and descendants, and support moving to root.
- Fix move modal touch layering so buttons are always clickable on mobile (outer Pressable backdrop + inner Pressable content).
- Confirm Move must call existing handleMoveAction with selected target and close modal on success.

Editor requirements:
- Highlight/underline must be visible in on-screen preview (normalize span/font markup to mark/u).
- Add multiple highlight colors in toolbar picker.
- Add explicit unhighlight action (eraser/transparent) that removes highlight wrappers/transparent highlight.

Constraints:
- Keep changes minimal and preserve current functionality.
- Do not edit unrelated files.
- After edits run typecheck and report errors.

Run:
- npm install
- npx tsc --noEmit