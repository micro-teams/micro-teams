/*
 * The two bodies most dialogs have: a line of text to type, and a yes-or-no about something that
 * cannot be undone. Drawn inside ask()'s dialog; every such dialog in the app is one of these.
 *
 * <TextPrompt initial? placeholder? action testID okTestID? numeric? done> — a field and one
 *   button; the button (or the keyboard's return) answers with what was typed, and is disabled
 *   while that is blank. okTestID defaults to `${testID}-ok`.
 * <Confirm text action done> — the consequence in words, then "cancel" (answers false) and the
 *   action (answers true).
 *
 * Example:
 *   const title = await ask<string>("rename chat", (done) => (
 *     <TextPrompt testID="rename" initial={current} action="rename" done={done} />
 *   ));
 */
import { useState } from "react";
import { DialogActions } from "./Dialog";
import { Button, Field, Txt } from "./kit";

export function TextPrompt({
  initial = "",
  placeholder,
  action,
  testID,
  okTestID,
  numeric,
  done,
}: {
  initial?: string;
  placeholder?: string;
  action: string;
  testID: string;
  okTestID?: string;
  numeric?: boolean;
  done: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Field
        testID={testID}
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        autoFocus
        keyboardType={numeric ? "number-pad" : "default"}
        onSubmitEditing={() => value.trim() && done(value)}
      />
      <DialogActions>
        <Button kind="text" testID={okTestID ?? `${testID}-ok`} label={action} onPress={() => done(value)} disabled={!value.trim()} />
      </DialogActions>
    </>
  );
}

export function Confirm({ text, action, done }: { text: string; action: string; done: (ok: boolean) => void }) {
  return (
    <>
      <Txt muted>{text}</Txt>
      <DialogActions>
        <Button kind="text" label="cancel" onPress={() => done(false)} />
        <Button kind="text" testID="confirm" label={action} onPress={() => done(true)} />
      </DialogActions>
    </>
  );
}
