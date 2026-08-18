import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  getPreferenceValues,
  Icon,
  Keyboard,
  List,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { randomUUID } from "node:crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  activateResumeWork,
  createResumeWork,
  loadResumeState,
  ResumeState,
  ResumeWork,
  setResumeNote,
} from "./context-events";
import { domainsFor, formatContextCapture, urlsIn, CaptureMetadataV1 } from "./capture-metadata";
import { saveCapture } from "./database";
import { getI18n, RaycastLocalePreferences } from "./i18n";

type I18n = ReturnType<typeof getI18n>;

type ViewMode = "capture" | "resume";

const captureModeShortcut: Keyboard.Shortcut = {
  macOS: { modifiers: ["cmd"], key: "1" },
  Windows: { modifiers: ["ctrl"], key: "1" },
};
const resumeModeShortcut: Keyboard.Shortcut = {
  macOS: { modifiers: ["cmd"], key: "2" },
  Windows: { modifiers: ["ctrl"], key: "2" },
};
const saveResumeNoteShortcut: Keyboard.Shortcut = {
  macOS: { modifiers: ["cmd", "shift"], key: "enter" },
  Windows: { modifiers: ["ctrl", "shift"], key: "enter" },
};
const importClipboardShortcut: Keyboard.Shortcut = {
  macOS: { modifiers: ["cmd", "shift"], key: "v" },
  Windows: { modifiers: ["ctrl", "shift"], key: "v" },
};
const importClipboardShortcutLabel = process.platform === "darwin" ? "⌘⇧V" : "Ctrl+Shift+V";

function WorkForm({ onCreate, i18n }: { onCreate: (name: string) => Promise<void>; i18n: I18n }) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={i18n.t("capture.workStart")}
            onSubmit={async ({ name }: { name: string }) => {
              const trimmedName = name.trim();
              if (!trimmedName) {
                await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.workNameRequired") });
                return;
              }
              await onCreate(trimmedName);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title={i18n.t("capture.workName")}
        placeholder={i18n.t("capture.workNamePlaceholder")}
        autoFocus
      />
    </Form>
  );
}

function WorkPicker({
  works,
  activeWork,
  onSelect,
  i18n,
}: {
  works: ResumeWork[];
  activeWork: ResumeWork | null;
  onSelect: (work: ResumeWork) => Promise<void>;
  i18n: I18n;
}) {
  const { pop } = useNavigation();
  return (
    <List searchBarPlaceholder={i18n.t("capture.selectWork")}>
      {works.map((work) => (
        <List.Item
          key={work.id}
          title={work.name}
          icon={work.id === activeWork?.id ? Icon.CheckCircle : Icon.Circle}
          actions={
            <ActionPanel>
              <Action
                title={i18n.t("capture.setCurrentWork")}
                onAction={async () => {
                  await onSelect(work);
                  pop();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function ResumeView({
  state,
  isLoading,
  error,
  onCaptureMode,
  onCreateWork,
  onSelectWork,
  i18n,
}: {
  state: ResumeState;
  isLoading: boolean;
  error: string | null;
  onCaptureMode: () => void;
  onCreateWork: (name: string) => Promise<void>;
  onSelectWork: (work: ResumeWork) => Promise<void>;
  i18n: I18n;
}) {
  const navigationActions = (
    <>
      {state.works.length > 0 && (
        <Action.Push
          title={i18n.t("capture.changeWork")}
          icon={Icon.ArrowRight}
          target={<WorkPicker works={state.works} activeWork={state.activeWork} onSelect={onSelectWork} i18n={i18n} />}
        />
      )}
      <Action.Push
        title={i18n.t("capture.newWork")}
        icon={Icon.Plus}
        target={<WorkForm onCreate={onCreateWork} i18n={i18n} />}
      />
      <Action
        title={i18n.t("capture.backToCapture")}
        icon={Icon.TextCursor}
        shortcut={captureModeShortcut}
        onAction={onCaptureMode}
      />
    </>
  );

  if (error) {
    return (
      <List>
        <List.EmptyView icon={Icon.ExclamationMark} title={i18n.t("capture.resumeContextError")} description={error} />
      </List>
    );
  }

  if (!state.activeWork && !isLoading) {
    return (
      <List navigationTitle={i18n.t("capture.manageWork")}>
        <List.EmptyView
          icon={Icon.Folder}
          title={i18n.t("capture.noWork")}
          description={i18n.t("capture.startWorkHelp")}
          actions={<ActionPanel>{navigationActions}</ActionPanel>}
        />
      </List>
    );
  }

  const activeWork = state.activeWork;
  return (
    <List isLoading={isLoading} navigationTitle={activeWork?.name ?? i18n.t("capture.manageWork")}>
      {activeWork && (
        <List.Section title={i18n.t("capture.resumeSection")}>
          <List.Item
            title={state.resumeNote ?? i18n.t("capture.noResumeNote")}
            subtitle={
              state.resumeNote ? i18n.t("capture.resumeNoteSubtitle") : i18n.t("capture.resumeNoteEmptySubtitle")
            }
            icon={Icon.Forward}
            actions={
              <ActionPanel>
                <Action title={i18n.t("capture.writeResumeNote")} icon={Icon.TextCursor} onAction={onCaptureMode} />
                {navigationActions}
              </ActionPanel>
            }
          />
        </List.Section>
      )}
    </List>
  );
}

export function CaptureCommand() {
  const localePreferences = getPreferenceValues<RaycastLocalePreferences>();
  const i18n = useMemo(() => getI18n(localePreferences), [localePreferences.language]);
  const [content, setContent] = useState("");
  const [importedContent, setImportedContent] = useState("");
  const [originalImportedContent, setOriginalImportedContent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("capture");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeState, setResumeState] = useState<ResumeState>({ activeWork: null, resumeNote: null, works: [] });
  const [isLoadingResume, setIsLoadingResume] = useState(true);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const refreshResumeState = useCallback(async () => {
    setIsLoadingResume(true);
    try {
      setResumeState(await loadResumeState());
      setResumeError(null);
    } catch (reason) {
      setResumeError(reason instanceof Error ? reason.message : i18n.t("capture.resumeContextError"));
    } finally {
      setIsLoadingResume(false);
    }
  }, [i18n]);

  useEffect(() => {
    void refreshResumeState();
  }, [refreshResumeState]);

  async function importClipboard() {
    try {
      const clipboardContent = await Clipboard.readText();
      if (!clipboardContent?.trim()) {
        await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.clipboardEmpty") });
        return;
      }

      setImportedContent(clipboardContent);
      setOriginalImportedContent(clipboardContent);
      await showToast({ style: Toast.Style.Success, title: i18n.t("capture.clipboardImported") });
    } catch (error) {
      console.error("Failed to read clipboard", error);
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.clipboardImportFailed") });
    }
  }

  function clearImportedContent() {
    setImportedContent("");
    setOriginalImportedContent(null);
  }

  async function handleSubmit() {
    const trimmedContent = content.trim();
    const hasImportedContent = originalImportedContent !== null && Boolean(importedContent.trim());
    if (!trimmedContent && !hasImportedContent) {
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.contentRequired") });
      return;
    }

    setIsSubmitting(true);
    try {
      const id = randomUUID();
      const capturedAt = new Date().toISOString();
      const importedText = hasImportedContent ? importedContent : "";
      const body = trimmedContent ? `${importedText}\n\n${trimmedContent}` : importedText;
      const importedUrls = urlsIn(importedText);
      const metadata: CaptureMetadataV1 | null = hasImportedContent
        ? {
            segments: [
              {
                origin: "imported",
                kind: importedUrls.length === 1 && importedUrls[0] === importedText ? "link" : "text",
                start: 0,
                end: importedText.length,
                sourceUrls: importedUrls,
                sourceDomains: domainsFor(importedUrls),
                edited: originalImportedContent !== importedContent,
              },
              ...(trimmedContent
                ? [
                    {
                      origin: "authored" as const,
                      kind: "text" as const,
                      start: importedText.length + 2,
                      end: body.length,
                    },
                  ]
                : []),
            ],
          }
        : null;
      const savedContent = metadata ? formatContextCapture(metadata, body) : trimmedContent;
      await saveCapture(id, savedContent, capturedAt);
      setContent("");
      clearImportedContent();
      await showHUD(i18n.t("capture.saved"));
    } catch (error) {
      console.error("Failed to save capture", error);
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.saveFailed") });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResumeNoteSubmit() {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.resumeNoteRequired") });
      return;
    }
    if (!resumeState.activeWork) {
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.startWorkFirst") });
      return;
    }

    setIsSubmitting(true);
    try {
      await setResumeNote(resumeState.activeWork, trimmedContent);
      setContent("");
      await refreshResumeState();
      await showToast({ style: Toast.Style.Success, title: i18n.t("capture.resumeNoteSaved") });
    } catch (error) {
      console.error("Failed to save resume note", error);
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.resumeNoteSaveFailed") });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function performContextMutation(action: () => Promise<void>) {
    try {
      await action();
      await refreshResumeState();
    } catch (error) {
      console.error("Failed to update resume context", error);
      await showToast({ style: Toast.Style.Failure, title: i18n.t("capture.contextSaveFailed") });
    }
  }

  if (viewMode === "resume") {
    return (
      <ResumeView
        state={resumeState}
        isLoading={isLoadingResume}
        error={resumeError}
        onCaptureMode={() => setViewMode("capture")}
        onCreateWork={(name) => performContextMutation(() => createResumeWork(name))}
        onSelectWork={(work) => performContextMutation(() => activateResumeWork(work))}
        i18n={i18n}
      />
    );
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={i18n.t("capture.save")} onSubmit={handleSubmit} />
          {resumeState.activeWork && (
            <Action.SubmitForm
              title={i18n.t("capture.saveAsResumeNote")}
              shortcut={saveResumeNoteShortcut}
              onSubmit={handleResumeNoteSubmit}
            />
          )}
          <Action
            title={i18n.t("capture.importClipboard")}
            icon={Icon.Clipboard}
            shortcut={importClipboardShortcut}
            onAction={importClipboard}
          />
          {originalImportedContent !== null && (
            <Action title={i18n.t("capture.clearImported")} icon={Icon.Trash} onAction={clearImportedContent} />
          )}
          <Action
            title={i18n.t("capture.manageWork")}
            icon={Icon.Folder}
            shortcut={resumeModeShortcut}
            onAction={() => setViewMode("resume")}
          />
        </ActionPanel>
      }
    >
      {resumeState.activeWork ? (
        <>
          <Form.Description title={i18n.t("capture.currentWork")} text={resumeState.activeWork.name} />
          <Form.Description
            title={i18n.t("capture.resumeSection")}
            text={resumeState.resumeNote ?? i18n.t("capture.noResumeNote")}
          />
        </>
      ) : (
        <Form.Description title={i18n.t("capture.currentWork")} text={i18n.t("capture.noWork")} />
      )}
      {originalImportedContent !== null ? (
        <>
          <Form.TextArea
            id="importedContent"
            title={i18n.t("capture.importedContent")}
            value={importedContent}
            onChange={setImportedContent}
          />
          <Form.Description text={i18n.t("capture.clearImportedHelp")} />
        </>
      ) : (
        <Form.Description
          title={i18n.t("capture.importedContent")}
          text={i18n.t("capture.clipboardShortcutHelp", { shortcut: importClipboardShortcutLabel })}
        />
      )}
      <Form.TextArea
        id="content"
        title={i18n.t("capture.myNote")}
        placeholder={i18n.t(resumeState.activeWork ? "capture.notePlaceholderWithWork" : "capture.notePlaceholder")}
        value={content}
        onChange={setContent}
        autoFocus
      />
    </Form>
  );
}

export default function ProductionCaptureCommand() {
  return <CaptureCommand />;
}
