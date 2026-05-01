-- Notes hierarchy: SQL functions used by NoteHierarchyService against existing user_note_nodes.

CREATE OR REPLACE FUNCTION public.rename_note_node(p_node_id uuid, p_user_id uuid, p_title text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title required';
  END IF;
  UPDATE public.user_note_nodes
     SET title = trim(p_title), updated_at = now()
   WHERE id = p_node_id AND user_id = p_user_id;

  UPDATE public.user_notes n
     SET title = trim(p_title), updated_at = now()
    FROM public.user_note_nodes nn
   WHERE nn.id = p_node_id AND nn.user_id = p_user_id
     AND nn.type = 'note' AND nn.note_id = n.id;
END $$;

CREATE OR REPLACE FUNCTION public.move_note_node(
  p_node_id uuid, p_user_id uuid, p_new_parent_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_kind text;
  v_cycle int;
BEGIN
  SELECT type INTO v_kind FROM public.user_note_nodes
   WHERE id = p_node_id AND user_id = p_user_id;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'node not found'; END IF;

  IF p_new_parent_id IS NOT NULL THEN
    PERFORM 1 FROM public.user_note_nodes
      WHERE id = p_new_parent_id AND user_id = p_user_id AND type = 'folder';
    IF NOT FOUND THEN RAISE EXCEPTION 'parent must be a folder'; END IF;

    WITH RECURSIVE chain AS (
      SELECT id, parent_id FROM public.user_note_nodes
       WHERE id = p_new_parent_id AND user_id = p_user_id
      UNION ALL
      SELECT n.id, n.parent_id FROM public.user_note_nodes n
       JOIN chain c ON n.id = c.parent_id
       WHERE n.user_id = p_user_id
    )
    SELECT count(*) INTO v_cycle FROM chain WHERE id = p_node_id;
    IF v_cycle > 0 THEN RAISE EXCEPTION 'cannot move node into its own descendant'; END IF;
  END IF;

  UPDATE public.user_note_nodes
     SET parent_id = p_new_parent_id, updated_at = now()
   WHERE id = p_node_id AND user_id = p_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_note_node_cascade(p_node_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_note_ids uuid[];
BEGIN
  WITH RECURSIVE sub AS (
    SELECT id, note_id FROM public.user_note_nodes
     WHERE id = p_node_id AND user_id = p_user_id
    UNION ALL
    SELECT n.id, n.note_id FROM public.user_note_nodes n
     JOIN sub s ON n.parent_id = s.id
     WHERE n.user_id = p_user_id
  )
  SELECT array_agg(note_id) INTO v_note_ids FROM sub WHERE note_id IS NOT NULL;

  DELETE FROM public.user_note_nodes WHERE id = p_node_id AND user_id = p_user_id;

  IF v_note_ids IS NOT NULL THEN
    DELETE FROM public.user_notes WHERE id = ANY(v_note_ids) AND user_id = p_user_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.rename_note_node, public.move_note_node, public.delete_note_node_cascade TO authenticated;
