import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  Keyboard,
  List,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { randomUUID } from "node:crypto";
import { useCallback, useEffect, useState } from "react";
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

function WorkForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Work 시작"
            onSubmit={async ({ name }: { name: string }) => {
              const trimmedName = name.trim();
              if (!trimmedName) {
                await showToast({ style: Toast.Style.Failure, title: "Work 이름을 입력하세요" });
                return;
              }
              await onCreate(trimmedName);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Work 이름" placeholder="예: Context OS QA 하기" autoFocus />
    </Form>
  );
}

function WorkPicker({
  works,
  activeWork,
  onSelect,
}: {
  works: ResumeWork[];
  activeWork: ResumeWork | null;
  onSelect: (work: ResumeWork) => Promise<void>;
}) {
  const { pop } = useNavigation();
  return (
    <List searchBarPlaceholder="현재 Work 선택">
      {works.map((work) => (
        <List.Item
          key={work.id}
          title={work.name}
          icon={work.id === activeWork?.id ? Icon.CheckCircle : Icon.Circle}
          actions={
            <ActionPanel>
              <Action
                title="현재 Work로 설정"
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
}: {
  state: ResumeState;
  isLoading: boolean;
  error: string | null;
  onCaptureMode: () => void;
  onCreateWork: (name: string) => Promise<void>;
  onSelectWork: (work: ResumeWork) => Promise<void>;
}) {
  const navigationActions = (
    <>
      {state.works.length > 0 && (
        <Action.Push
          title="현재 Work 변경"
          icon={Icon.ArrowRight}
          target={<WorkPicker works={state.works} activeWork={state.activeWork} onSelect={onSelectWork} />}
        />
      )}
      <Action.Push title="새 Work 시작" icon={Icon.Plus} target={<WorkForm onCreate={onCreateWork} />} />
      <Action
        title="Capture로 돌아가기"
        icon={Icon.TextCursor}
        shortcut={captureModeShortcut}
        onAction={onCaptureMode}
      />
    </>
  );

  if (error) {
    return (
      <List>
        <List.EmptyView icon={Icon.ExclamationMark} title="재개 맥락을 불러올 수 없습니다" description={error} />
      </List>
    );
  }

  if (!state.activeWork && !isLoading) {
    return (
      <List navigationTitle="Work 관리">
        <List.EmptyView
          icon={Icon.Folder}
          title="현재 Work가 없습니다"
          description="새 Work를 시작하면 멈춘 지점을 남길 수 있습니다."
          actions={<ActionPanel>{navigationActions}</ActionPanel>}
        />
      </List>
    );
  }

  const activeWork = state.activeWork;
  return (
    <List isLoading={isLoading} navigationTitle={activeWork?.name ?? "Work 관리"}>
      {activeWork && (
        <List.Section title="재개 메모">
          <List.Item
            title={state.resumeNote ?? "아직 남긴 재개 메모가 없습니다"}
            subtitle={state.resumeNote ? "멈춘 지점과 시작할 곳" : "작업을 멈출 때 한 줄만 남기세요"}
            icon={Icon.Forward}
            actions={
              <ActionPanel>
                <Action title="Capture에서 재개 메모 작성" icon={Icon.TextCursor} onAction={onCaptureMode} />
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
      setResumeError(reason instanceof Error ? reason.message : "재개 맥락을 불러올 수 없습니다");
    } finally {
      setIsLoadingResume(false);
    }
  }, []);

  useEffect(() => {
    void refreshResumeState();
  }, [refreshResumeState]);

  async function importClipboard() {
    try {
      const clipboardContent = await Clipboard.readText();
      if (!clipboardContent?.trim()) {
        await showToast({ style: Toast.Style.Failure, title: "클립보드에 텍스트가 없습니다" });
        return;
      }

      setImportedContent(clipboardContent);
      setOriginalImportedContent(clipboardContent);
      await showToast({ style: Toast.Style.Success, title: "클립보드 자료를 가져왔습니다" });
    } catch (error) {
      console.error("Failed to read clipboard", error);
      await showToast({ style: Toast.Style.Failure, title: "클립보드 자료를 가져오지 못했습니다" });
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
      await showToast({ style: Toast.Style.Failure, title: "Capture 내용을 입력하세요" });
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
      await showHUD("Capture를 저장했습니다");
    } catch (error) {
      console.error("Failed to save capture", error);
      await showToast({ style: Toast.Style.Failure, title: "Capture를 저장하지 못했습니다" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResumeNoteSubmit() {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      await showToast({ style: Toast.Style.Failure, title: "재개 메모를 입력하세요" });
      return;
    }
    if (!resumeState.activeWork) {
      await showToast({ style: Toast.Style.Failure, title: "먼저 현재 Work를 시작하세요" });
      return;
    }

    setIsSubmitting(true);
    try {
      await setResumeNote(resumeState.activeWork, trimmedContent);
      setContent("");
      await refreshResumeState();
      await showToast({ style: Toast.Style.Success, title: "재개 메모를 저장했습니다" });
    } catch (error) {
      console.error("Failed to save resume note", error);
      await showToast({ style: Toast.Style.Failure, title: "재개 메모를 저장하지 못했습니다" });
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
      await showToast({ style: Toast.Style.Failure, title: "재개 맥락을 저장하지 못했습니다" });
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
      />
    );
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture 저장" onSubmit={handleSubmit} />
          {resumeState.activeWork && (
            <Action.SubmitForm
              title="재개 메모로 저장"
              shortcut={saveResumeNoteShortcut}
              onSubmit={handleResumeNoteSubmit}
            />
          )}
          <Action
            title="클립보드에서 자료 가져오기"
            icon={Icon.Clipboard}
            shortcut={importClipboardShortcut}
            onAction={importClipboard}
          />
          {originalImportedContent !== null && (
            <Action title="가져온 자료 지우기" icon={Icon.Trash} onAction={clearImportedContent} />
          )}
          <Action
            title="Work 관리"
            icon={Icon.Folder}
            shortcut={resumeModeShortcut}
            onAction={() => setViewMode("resume")}
          />
        </ActionPanel>
      }
    >
      {resumeState.activeWork ? (
        <>
          <Form.Description title="현재 Work" text={resumeState.activeWork.name} />
          <Form.Description title="재개 메모" text={resumeState.resumeNote ?? "아직 남긴 재개 메모가 없습니다"} />
        </>
      ) : (
        <Form.Description title="현재 Work" text="현재 Work가 없습니다" />
      )}
      {originalImportedContent !== null ? (
        <>
          <Form.TextArea
            id="importedContent"
            title="가져온 자료"
            value={importedContent}
            onChange={setImportedContent}
          />
          <Form.Description text="제거하려면 Action Panel에서 ‘가져온 자료 지우기’를 선택하세요." />
        </>
      ) : (
        <Form.Description
          title="가져온 자료"
          text={`${importClipboardShortcutLabel}를 눌러 클립보드 자료를 출처로 추가하세요.`}
        />
      )}
      <Form.TextArea
        id="content"
        title="내 메모"
        placeholder={resumeState.activeWork ? "생각을 남기거나 재개 메모를 작성하세요…" : "생각을 바로 남기세요…"}
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
