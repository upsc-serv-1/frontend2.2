import React, { useRef, useEffect, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Eraser, Highlighter, Palette } from 'lucide-react-native';

const HIGHLIGHT_COLORS = [
  '#FFF59D',
  '#FFB74D',
  '#81C784',
  '#4FC3F7',
  '#BA68C8',
  '#FF6A88',
  '#FFD54F',
  '#80CBC4',
  '#90CAF9',
  '#EF9A9A',
];
const DEFAULT_COLOR_KEY = 'notes_editor_highlight_color';

type Props = {
  html: string;
  onChange: (html: string) => void;
  themeColors: { bg: string; surface: string; textPrimary: string; border: string; primary: string };
};

export default function RichNoteEditor({ html, onChange, themeColors }: Props) {
  const editorRef = useRef<RichEditor>(null);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(DEFAULT_COLOR_KEY).then(v => { if (v) setHighlightColor(v); });
  }, []);

  const applyHighlight = (selectedColor?: string) => {
    const color = selectedColor ?? highlightColor;
    if (color === 'transparent') {
      editorRef.current?.commandDOM(`
        (function() {
          var sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            var range = sel.getRangeAt(0);
            var parentMark = range.commonAncestorContainer.parentElement;
            if (parentMark && parentMark.tagName === 'MARK') {
               var text = document.createTextNode(parentMark.textContent);
               parentMark.parentNode.replaceChild(text, parentMark);
            }
          }
        })();
      `);
      return;
    }
    editorRef.current?.commandDOM(`
      (function() {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          var range = sel.getRangeAt(0);
          var mark = document.createElement('mark');
          mark.style.backgroundColor = '${color}';
          mark.style.color = '#000';
          range.surroundContents(mark);
        }
      })()
    `);
  };

  const pickColor = async (c: string) => {
    setHighlightColor(c);
    await AsyncStorage.setItem(DEFAULT_COLOR_KEY, c);
    setShowPicker(false);
    applyHighlight(c);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: themeColors.bg || '#ffffff' }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
        <RichEditor
          ref={editorRef}
          initialContentHTML={html}
          onChange={onChange}
          placeholder="Start writing..."
          style={{ minHeight: 500, backgroundColor: themeColors.bg || '#ffffff' }}
          editorStyle={{
            backgroundColor: themeColors.bg || '#ffffff',
            color: themeColors.textPrimary || '#000000',
            contentCSSText: 'font-size:16px;line-height:1.5;padding:12px; mark { border-radius: 2px; padding: 0 2px; }',
          }}
        />
      </ScrollView>

      {showPicker && (
        <View style={[s.picker, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          {HIGHLIGHT_COLORS.map(c => (
            <TouchableOpacity key={c} onPress={() => pickColor(c)}
              style={[s.swatch, { 
                backgroundColor: c === 'transparent' ? themeColors.surface : c, 
                borderColor: c === highlightColor ? themeColors.primary : themeColors.border 
              }]}
            >
              {c === 'transparent' ? <Eraser size={12} color={themeColors.textPrimary} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <RichToolbar
        editor={editorRef}
        selectedIconTint={themeColors.primary}
        iconTint={themeColors.textPrimary}
        style={{ backgroundColor: themeColors.surface, borderTopWidth: 1, borderTopColor: themeColors.border }}
        actions={[
          actions.setBold,
          actions.setItalic,
          actions.setUnderline,
          actions.insertBulletsList,
          actions.insertOrderedList,
          actions.heading1,
          'highlight_apply',
          'highlight_picker',
          'highlight_clear',
        ]}
        iconMap={{
          [actions.heading1]: ({ tintColor }: any) => <View style={{ padding: 4 }}><Highlighter size={0} color={tintColor} /></View>,
          highlight_apply: ({ tintColor }: any) => (
            <TouchableOpacity onPress={() => applyHighlight(highlightColor)}>
              <View style={[s.hlIcon, { backgroundColor: highlightColor }]}>
                <Highlighter size={16} color={tintColor} />
              </View>
            </TouchableOpacity>
          ),
          highlight_picker: ({ tintColor }: any) => (
            <TouchableOpacity onPress={() => setShowPicker(v => !v)}>
              <View style={s.toolIcon}>
                <Palette size={16} color={tintColor} />
              </View>
            </TouchableOpacity>
          ),
          highlight_clear: ({ tintColor }: any) => (
            <TouchableOpacity onPress={() => applyHighlight('transparent')}>
              <View style={s.toolIcon}>
                <Eraser size={16} color={tintColor} />
              </View>
            </TouchableOpacity>
          ),
        }}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, borderTopWidth: 1, justifyContent: 'center' },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  hlIcon: { padding: 6, borderRadius: 6 },
  toolIcon: { padding: 6, borderRadius: 6 },
});
