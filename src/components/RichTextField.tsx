import React, { useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { Bold, Italic, Underline, Highlighter, List as ListIcon, Hash } from 'lucide-react-native';

type Tag = 'bold' | 'italic' | 'underline' | 'mark' | 'bullet' | 'h2';

const wrap = (txt: string, sel: { start: number; end: number }, openTag: string, closeTag: string) => {
  const before = txt.slice(0, sel.start);
  const middle = txt.slice(sel.start, sel.end) || 'text';
  const after  = txt.slice(sel.end);
  return { value: `${before}${openTag}${middle}${closeTag}${after}`,
           cursor: before.length + openTag.length + middle.length + closeTag.length };
};

export function RichTextField(props: {
  value: string; onChangeText: (s: string) => void;
  placeholder?: string; minHeight?: number;
  primaryColor: string; surface: string; textColor: string; border: string;
}) {
  const ref = useRef<TextInput>(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const apply = (tag: Tag) => {
    const map: Record<Tag, [string, string]> = {
      bold: ['**', '**'], italic: ['_', '_'],
      underline: ['<u>', '</u>'], mark: ['<mark>', '</mark>'],
      bullet: ['\n- ', ''], h2: ['\n## ', ''],
    };
    const [o, c] = map[tag];
    const { value, cursor } = wrap(props.value, sel, o, c);
    props.onChangeText(value);
    setTimeout(() => ref.current?.setNativeProps({ selection: { start: cursor, end: cursor } }), 0);
  };
  const Btn = ({ tag, Icon }: { tag: Tag; Icon: any }) => (
    <TouchableOpacity onPress={() => apply(tag)} style={s.btn}>
      <Icon size={16} color={props.primaryColor} />
    </TouchableOpacity>
  );
  return (
    <View>
      <View style={[s.toolbar, { borderColor: props.border, backgroundColor: props.surface }]}>
        <Btn tag="bold" Icon={Bold} /><Btn tag="italic" Icon={Italic} />
        <Btn tag="underline" Icon={Underline} /><Btn tag="mark" Icon={Highlighter} />
        <Btn tag="bullet" Icon={ListIcon} /><Btn tag="h2" Icon={Hash} />
      </View>
      <TextInput ref={ref} multiline value={props.value}
        onChangeText={props.onChangeText}
        onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
        placeholder={props.placeholder}
        placeholderTextColor={props.border}
        style={[s.input, { borderColor: props.border, backgroundColor: props.surface, color: props.textColor, minHeight: props.minHeight ?? 100 }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: 6, padding: 8, borderWidth: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  btn: { padding: 8, borderRadius: 8 },
  input: { borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 15 },
});
