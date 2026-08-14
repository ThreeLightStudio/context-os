import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useLocalStorage } from "@raycast/utils";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { parseContextCapture } from "./capture-metadata";
import { Capture, contextEventPrefix, listAllCaptures, listAllRecentCaptures, listRecentCaptures } from "./database";

type ContextEventType =
  "work-created" | "work-activated" | "resume-note-set" | "legacy-work-item" | "legacy-migration-completed";

interface ContextEventMetadata {
  type: ContextEventType;
  name?: string;
  note?: string;
}

interface CapturePresentation {
  title: string;
  subtitle: string;
  icon: Icon;
}

const eventTitles: Record<ContextEventType, string> = {
  "work-created": "Work 시작",
  "work-activated": "현재 Work 변경",
  "resume-note-set": "재개 메모",
  "legacy-work-item": "기존 단계 기록",
  "legacy-migration-completed": "기존 기록 이관 완료",
};

const eventIcons: Record<ContextEventType, Icon> = {
  "work-created": Icon.Plus,
  "work-activated": Icon.ArrowRight,
  "resume-note-set": Icon.Forward,
  "legacy-work-item": Icon.List,
  "legacy-migration-completed": Icon.CheckCircle,
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function contextText(captures: Capture[]) {
  return [
    "# Context Export",
    ...captures.flatMap((capture) => ["", `## ${formatTimestamp(capture.capturedAt)}`, "", capture.content]),
  ].join("\n");
}

async function copyContext(captures: Capture[]) {
  if (captures.length === 0) {
    await showToast({ style: Toast.Style.Failure, title: "No captures to copy" });
    return;
  }

  await Clipboard.copy(contextText(captures));
  await showToast({
    style: Toast.Style.Success,
    title: `Copied ${captures.length} capture${captures.length === 1 ? "" : "s"}`,
  });
}

async function copyFullSsot() {
  try {
    await copyContext(await listAllCaptures());
  } catch (reason) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not copy SSOT export",
      message: reason instanceof Error ? reason.message : "Unable to load captures",
    });
  }
}

function capturesSince(captures: Capture[], start: Date, end = new Date()) {
  return captures.filter((capture) => {
    const capturedAt = new Date(capture.capturedAt);
    return capturedAt >= start && capturedAt <= end;
  });
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function TimeRangeForm({ captures }: { captures: Capture[] }) {
  const { pop } = useNavigation();
  const now = new Date();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Copy Time Range"
            icon={Icon.Clipboard}
            onSubmit={async (values: { start: Date; end: Date }) => {
              if (values.start > values.end) {
                await showToast({ style: Toast.Style.Failure, title: "Start must be before end" });
                return;
              }

              await copyContext(capturesSince(captures, values.start, values.end));
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Copy raw captures created within the selected time range." />
      <Form.DatePicker id="start" title="From" type={Form.DatePicker.Type.DateTime} defaultValue={startOfToday()} />
      <Form.DatePicker id="end" title="To" type={Form.DatePicker.Type.DateTime} defaultValue={now} />
    </Form>
  );
}

function ExportActions({
  capture,
  visibleCaptures,
  captures,
}: {
  capture: Capture;
  visibleCaptures: Capture[];
  captures: Capture[];
}) {
  return (
    <>
      <Action title="Copy This Capture" icon={Icon.Clipboard} onAction={() => copyContext([capture])} />
      <Action title="Copy Visible Captures" icon={Icon.Clipboard} onAction={() => copyContext(visibleCaptures)} />
      <Action
        title="Copy Today"
        icon={Icon.Clipboard}
        onAction={() => copyContext(capturesSince(captures, startOfToday()))}
      />
      <Action
        title="Copy Last 1 Hour"
        icon={Icon.Clipboard}
        onAction={() => copyContext(capturesSince(captures, new Date(Date.now() - 60 * 60 * 1000)))}
      />
      <Action
        title="Copy Last 24 Hours"
        icon={Icon.Clipboard}
        onAction={() => copyContext(capturesSince(captures, new Date(Date.now() - 24 * 60 * 60 * 1000)))}
      />
      <Action.Push title="Copy Time Range" icon={Icon.Clipboard} target={<TimeRangeForm captures={captures} />} />
      <Action
        title="Copy Full SSOT Including Context-OS Events"
        icon={Icon.Clipboard}
        onAction={() => copyFullSsot()}
      />
    </>
  );
}

function CaptureDetail({
  capture,
  visibleCaptures,
  captures,
}: {
  capture: Capture;
  visibleCaptures: Capture[];
  captures: Capture[];
}) {
  const parsedCapture = parseContextCapture(capture.content);
  const displayedContent = parsedCapture?.body ?? capture.content;
  const rawContent = displayedContent
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  return (
    <Detail
      markdown={rawContent}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Created" text={new Date(capture.createdAt).toLocaleString()} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ExportActions capture={capture} visibleCaptures={visibleCaptures} captures={captures} />
          <Action.CopyToClipboard title="Copy Content" content={capture.content} />
          <Action title="Copy as Context" icon={Icon.Clipboard} onAction={() => copyContext([capture])} />
        </ActionPanel>
      }
    />
  );
}

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0]?.trim() || "Untitled capture";
}

function rawEventBody(content: string) {
  const marker = "\n-->\n";
  const markerIndex = content.indexOf(marker);
  return markerIndex === -1 ? content : content.slice(markerIndex + marker.length);
}

function eventWorkName(metadata: ContextEventMetadata, body: string) {
  if (metadata.name) return metadata.name;
  const parts = body.split("\n---\n");
  return parts[1]?.split(/\r?\n/, 1)[0]?.trim();
}

function parseContextEvent(capture: Capture): { metadata: ContextEventMetadata; body: string } | null {
  const match = capture.content.match(/^<!-- context-os:event:v1\n([^\n]+)\n-->\n([\s\S]*)$/);
  if (!match) return null;

  try {
    const metadata = JSON.parse(match[1]) as ContextEventMetadata;
    if (!metadata || !(metadata.type in eventTitles)) return null;
    return { metadata, body: match[2] };
  } catch {
    return null;
  }
}

function presentationFor(capture: Capture): CapturePresentation {
  const event = parseContextEvent(capture);
  if (!event) {
    const isUnparsedInternalEvent = capture.content.startsWith(contextEventPrefix);
    const structuredCapture = parseContextCapture(capture.content);
    if (structuredCapture) {
      const sourceDomains = structuredCapture.metadata.segments.flatMap((segment) => segment.sourceDomains ?? []);
      const hasLinks = structuredCapture.metadata.segments.some((segment) => (segment.sourceUrls?.length ?? 0) > 0);
      return {
        title: firstLine(structuredCapture.body),
        subtitle: hasLinks ? `가져온 링크 · ${[...new Set(sourceDomains)].join(", ") || "URL"}` : "가져온 자료",
        icon: hasLinks ? Icon.Link : Icon.Clipboard,
      };
    }
    return {
      title: isUnparsedInternalEvent ? "Context-OS 기록" : firstLine(capture.content),
      subtitle: isUnparsedInternalEvent
        ? firstLine(rawEventBody(capture.content))
        : capture.content.replace(/\s+/g, " ").trim(),
      icon: Icon.Document,
    };
  }

  const action = eventTitles[event.metadata.type];
  const workName = eventWorkName(event.metadata, event.body);
  const note = event.metadata.note?.split(/\r?\n/, 1)[0]?.trim();
  const bodySummary = firstLine(event.body);
  return {
    title: workName ? `${action} · ${workName}` : action,
    subtitle: note || bodySummary,
    icon: eventIcons[event.metadata.type],
  };
}

export function RecentCapturesCommand() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const { value: storedIncludesContextEvents, setValue: setIncludesContextEvents } = useLocalStorage<boolean>(
    "context-os:recent-captures:include-events:production:v1",
    false,
  );
  const includesContextEvents = storedIncludesContextEvents ?? false;

  useEffect(() => {
    setIsLoading(true);
    (includesContextEvents ? listAllRecentCaptures() : listRecentCaptures())
      .then(setCaptures)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load captures"))
      .finally(() => setIsLoading(false));
  }, [includesContextEvents]);

  const visibleCaptures = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) return captures;
    return captures.filter((capture) => capture.content.toLocaleLowerCase().includes(query));
  }, [captures, searchText]);

  const modeActions = (
    <Action
      title={includesContextEvents ? "Hide Context-OS Events" : "Include Context-OS Events"}
      icon={includesContextEvents ? Icon.EyeDisabled : Icon.Eye}
      onAction={() => setIncludesContextEvents(!includesContextEvents)}
    />
  );
  const emptyActions = (
    <ActionPanel>
      {modeActions}
      <Action
        title="Copy Full SSOT Including Context-OS Events"
        icon={Icon.Clipboard}
        onAction={() => copyFullSsot()}
      />
    </ActionPanel>
  );

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchBarPlaceholder="Filter recent captures"
      searchText={searchText}
      onSearchTextChange={setSearchText}
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not load captures"
          description={error}
          actions={emptyActions}
        />
      ) : captures.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Document}
          title="No captures yet"
          description="Save a capture to review it here."
          actions={emptyActions}
        />
      ) : visibleCaptures.length === 0 ? (
        <List.EmptyView icon={Icon.MagnifyingGlass} title="No matching captures" actions={emptyActions} />
      ) : (
        visibleCaptures.map((capture) => (
          <CaptureListItem
            key={capture.id}
            capture={capture}
            visibleCaptures={visibleCaptures}
            captures={captures}
            modeActions={modeActions}
          />
        ))
      )}
    </List>
  );
}

function CaptureListItem({
  capture,
  visibleCaptures,
  captures,
  modeActions,
}: {
  capture: Capture;
  visibleCaptures: Capture[];
  captures: Capture[];
  modeActions: ReactNode;
}) {
  const presentation = presentationFor(capture);
  return (
    <List.Item
      icon={presentation.icon}
      title={presentation.title}
      subtitle={presentation.subtitle}
      accessories={[{ date: new Date(capture.createdAt) }]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Open Capture"
            target={<CaptureDetail capture={capture} visibleCaptures={visibleCaptures} captures={captures} />}
          />
          <ExportActions capture={capture} visibleCaptures={visibleCaptures} captures={captures} />
          <Action.CopyToClipboard title="Copy Content" content={capture.content} />
          <Action title="Copy as Context" icon={Icon.Clipboard} onAction={() => copyContext([capture])} />
          <ActionPanel.Section>{modeActions}</ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function ProductionRecentCapturesCommand() {
  return <RecentCapturesCommand />;
}
