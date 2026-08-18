import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  getPreferenceValues,
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
import { getI18n, MessageKey, RaycastLocalePreferences } from "./i18n";

type I18n = ReturnType<typeof getI18n>;

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

const eventTitleKeys: Record<ContextEventType, MessageKey> = {
  "work-created": "recent.eventWorkCreated",
  "work-activated": "recent.eventWorkActivated",
  "resume-note-set": "recent.eventResumeNote",
  "legacy-work-item": "recent.eventLegacyWork",
  "legacy-migration-completed": "recent.eventLegacyMigration",
};

const eventIcons: Record<ContextEventType, Icon> = {
  "work-created": Icon.Plus,
  "work-activated": Icon.ArrowRight,
  "resume-note-set": Icon.Forward,
  "legacy-work-item": Icon.List,
  "legacy-migration-completed": Icon.CheckCircle,
};

function formatTimestamp(value: string, i18n: I18n) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : i18n.formatDate(date, { dateStyle: "medium", timeStyle: "short" });
}

function contextText(captures: Capture[], i18n: I18n) {
  return [
    `# ${i18n.t("recent.contextExport")}`,
    ...captures.flatMap((capture) => ["", `## ${formatTimestamp(capture.capturedAt, i18n)}`, "", capture.content]),
  ].join("\n");
}

async function copyContext(captures: Capture[], i18n: I18n) {
  if (captures.length === 0) {
    await showToast({ style: Toast.Style.Failure, title: i18n.t("recent.noCapturesToCopy") });
    return;
  }

  await Clipboard.copy(contextText(captures, i18n));
  await showToast({
    style: Toast.Style.Success,
    title: i18n.t("recent.copied", { count: captures.length }),
  });
}

async function copyFullSsot(i18n: I18n) {
  try {
    await copyContext(await listAllCaptures(), i18n);
  } catch (reason) {
    await showToast({
      style: Toast.Style.Failure,
      title: i18n.t("recent.copyFailed"),
      message: reason instanceof Error ? reason.message : i18n.t("recent.loadFailed"),
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

function TimeRangeForm({ captures, i18n }: { captures: Capture[]; i18n: I18n }) {
  const { pop } = useNavigation();
  const now = new Date();

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={i18n.t("recent.copyTimeRange")}
            icon={Icon.Clipboard}
            onSubmit={async (values: { start: Date; end: Date }) => {
              if (values.start > values.end) {
                await showToast({ style: Toast.Style.Failure, title: i18n.t("recent.rangeOrderError") });
                return;
              }

              await copyContext(capturesSince(captures, values.start, values.end), i18n);
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={i18n.t("recent.rangeDescription")} />
      <Form.DatePicker
        id="start"
        title={i18n.t("recent.from")}
        type={Form.DatePicker.Type.DateTime}
        defaultValue={startOfToday()}
      />
      <Form.DatePicker id="end" title={i18n.t("recent.to")} type={Form.DatePicker.Type.DateTime} defaultValue={now} />
    </Form>
  );
}

function ExportActions({
  capture,
  visibleCaptures,
  captures,
  i18n,
}: {
  capture: Capture;
  visibleCaptures: Capture[];
  captures: Capture[];
  i18n: I18n;
}) {
  return (
    <>
      <Action title={i18n.t("recent.copyThis")} icon={Icon.Clipboard} onAction={() => copyContext([capture], i18n)} />
      <Action
        title={i18n.t("recent.copyVisible")}
        icon={Icon.Clipboard}
        onAction={() => copyContext(visibleCaptures, i18n)}
      />
      <Action
        title={i18n.t("recent.copyToday")}
        icon={Icon.Clipboard}
        onAction={() => copyContext(capturesSince(captures, startOfToday()), i18n)}
      />
      <Action
        title={i18n.t("recent.copyHour")}
        icon={Icon.Clipboard}
        onAction={() => copyContext(capturesSince(captures, new Date(Date.now() - 60 * 60 * 1000)), i18n)}
      />
      <Action
        title={i18n.t("recent.copyDay")}
        icon={Icon.Clipboard}
        onAction={() => copyContext(capturesSince(captures, new Date(Date.now() - 24 * 60 * 60 * 1000)), i18n)}
      />
      <Action.Push
        title={i18n.t("recent.copyTimeRange")}
        icon={Icon.Clipboard}
        target={<TimeRangeForm captures={captures} i18n={i18n} />}
      />
      <Action title={i18n.t("recent.copyFull")} icon={Icon.Clipboard} onAction={() => copyFullSsot(i18n)} />
    </>
  );
}

function CaptureDetail({
  capture,
  visibleCaptures,
  captures,
  i18n,
}: {
  capture: Capture;
  visibleCaptures: Capture[];
  captures: Capture[];
  i18n: I18n;
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
          <Detail.Metadata.Label title={i18n.t("recent.created")} text={formatTimestamp(capture.createdAt, i18n)} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ExportActions capture={capture} visibleCaptures={visibleCaptures} captures={captures} i18n={i18n} />
          <Action.CopyToClipboard title={i18n.t("recent.copyContent")} content={capture.content} />
          <Action
            title={i18n.t("recent.copyAsContext")}
            icon={Icon.Clipboard}
            onAction={() => copyContext([capture], i18n)}
          />
        </ActionPanel>
      }
    />
  );
}

function firstLine(value: string, emptyLabel: string) {
  return value.split(/\r?\n/, 1)[0]?.trim() || emptyLabel;
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
    if (!metadata || !(metadata.type in eventTitleKeys)) return null;
    return { metadata, body: match[2] };
  } catch {
    return null;
  }
}

function presentationFor(capture: Capture, i18n: I18n): CapturePresentation {
  const event = parseContextEvent(capture);
  if (!event) {
    const isUnparsedInternalEvent = capture.content.startsWith(contextEventPrefix);
    const structuredCapture = parseContextCapture(capture.content);
    if (structuredCapture) {
      const sourceDomains = structuredCapture.metadata.segments.flatMap((segment) => segment.sourceDomains ?? []);
      const hasLinks = structuredCapture.metadata.segments.some((segment) => (segment.sourceUrls?.length ?? 0) > 0);
      return {
        title: firstLine(structuredCapture.body, i18n.t("recent.untitled")),
        subtitle: hasLinks
          ? i18n.t("recent.importedLink", { domain: [...new Set(sourceDomains)].join(", ") || "URL" })
          : i18n.t("recent.importedContent"),
        icon: hasLinks ? Icon.Link : Icon.Clipboard,
      };
    }
    return {
      title: isUnparsedInternalEvent
        ? i18n.t("recent.internalRecord")
        : firstLine(capture.content, i18n.t("recent.untitled")),
      subtitle: isUnparsedInternalEvent
        ? firstLine(rawEventBody(capture.content), i18n.t("recent.untitled"))
        : capture.content.replace(/\s+/g, " ").trim(),
      icon: Icon.Document,
    };
  }

  const action = i18n.t(eventTitleKeys[event.metadata.type]);
  const workName = eventWorkName(event.metadata, event.body);
  const note = event.metadata.note?.split(/\r?\n/, 1)[0]?.trim();
  const bodySummary = firstLine(event.body, i18n.t("recent.untitled"));
  return {
    title: workName ? `${action} · ${workName}` : action,
    subtitle: note || bodySummary,
    icon: eventIcons[event.metadata.type],
  };
}

export function RecentCapturesCommand() {
  const localePreferences = getPreferenceValues<RaycastLocalePreferences>();
  const i18n = useMemo(() => getI18n(localePreferences), [localePreferences.language]);
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
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : i18n.t("recent.loadFailed")))
      .finally(() => setIsLoading(false));
  }, [includesContextEvents, i18n]);

  const visibleCaptures = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) return captures;
    return captures.filter((capture) => capture.content.toLocaleLowerCase().includes(query));
  }, [captures, searchText]);

  const modeActions = (
    <Action
      title={i18n.t(includesContextEvents ? "recent.hideEvents" : "recent.includeEvents")}
      icon={includesContextEvents ? Icon.EyeDisabled : Icon.Eye}
      onAction={() => setIncludesContextEvents(!includesContextEvents)}
    />
  );
  const emptyActions = (
    <ActionPanel>
      {modeActions}
      <Action title={i18n.t("recent.copyFull")} icon={Icon.Clipboard} onAction={() => copyFullSsot(i18n)} />
    </ActionPanel>
  );

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchBarPlaceholder={i18n.t("recent.searchPlaceholder")}
      searchText={searchText}
      onSearchTextChange={setSearchText}
    >
      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={i18n.t("recent.loadFailed")}
          description={error}
          actions={emptyActions}
        />
      ) : captures.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Document}
          title={i18n.t("recent.noCaptures")}
          description={i18n.t("recent.noCapturesHelp")}
          actions={emptyActions}
        />
      ) : visibleCaptures.length === 0 ? (
        <List.EmptyView icon={Icon.MagnifyingGlass} title={i18n.t("recent.noMatches")} actions={emptyActions} />
      ) : (
        visibleCaptures.map((capture) => (
          <CaptureListItem
            key={capture.id}
            capture={capture}
            visibleCaptures={visibleCaptures}
            captures={captures}
            modeActions={modeActions}
            i18n={i18n}
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
  i18n,
}: {
  capture: Capture;
  visibleCaptures: Capture[];
  captures: Capture[];
  modeActions: ReactNode;
  i18n: I18n;
}) {
  const presentation = presentationFor(capture, i18n);
  return (
    <List.Item
      icon={presentation.icon}
      title={presentation.title}
      subtitle={presentation.subtitle}
      accessories={[{ text: formatTimestamp(capture.createdAt, i18n) }]}
      actions={
        <ActionPanel>
          <Action.Push
            title={i18n.t("recent.openCapture")}
            target={
              <CaptureDetail capture={capture} visibleCaptures={visibleCaptures} captures={captures} i18n={i18n} />
            }
          />
          <ExportActions capture={capture} visibleCaptures={visibleCaptures} captures={captures} i18n={i18n} />
          <Action.CopyToClipboard title={i18n.t("recent.copyContent")} content={capture.content} />
          <Action
            title={i18n.t("recent.copyAsContext")}
            icon={Icon.Clipboard}
            onAction={() => copyContext([capture], i18n)}
          />
          <ActionPanel.Section>{modeActions}</ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

export default function ProductionRecentCapturesCommand() {
  return <RecentCapturesCommand />;
}
