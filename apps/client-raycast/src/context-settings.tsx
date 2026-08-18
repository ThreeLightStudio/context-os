import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useMemo, useState } from "react";
import { describeContextConnection } from "./connection-status";
import { getI18n, RaycastLocalePreferences } from "./i18n";
import { checkRemoteRecordsConnection, RemoteRecordsError } from "./remote-records-api";

interface ContextPreferences extends RaycastLocalePreferences {
  serverUrl?: string;
  apiToken?: string;
}

function codeBlock(value: string) {
  const longestBacktickRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}\n${value}\n${fence}`;
}

export function ContextSettingsCommand() {
  const preferences = getPreferenceValues<ContextPreferences>();
  const i18n = useMemo(() => getI18n(preferences), [preferences.language]);
  const serverUrl = preferences.serverUrl?.trim() ?? "";
  const hasApiToken = Boolean(preferences.apiToken?.trim());
  const [connectionResult, setConnectionResult] = useState(i18n.t("settings.notChecked"));
  const connection = describeContextConnection(serverUrl, hasApiToken, i18n.t);

  const checkConnection = async () => {
    if (!serverUrl || !preferences.apiToken?.trim()) return;
    setConnectionResult(i18n.t("settings.checking"));
    try {
      await checkRemoteRecordsConnection({ serverUrl, apiToken: preferences.apiToken, timeoutMs: 10_000 });
      setConnectionResult(i18n.t("settings.connected"));
      await showToast({ style: Toast.Style.Success, title: i18n.t("settings.connectedToast") });
    } catch (error) {
      const message = error instanceof RemoteRecordsError ? error.message : i18n.t("settings.checkFailed");
      setConnectionResult(message);
      await showToast({ style: Toast.Style.Failure, title: i18n.t("settings.checkFailed"), message });
    }
  };

  return (
    <Detail
      markdown={`# ${i18n.t("settings.title")}

${i18n.t("settings.connectionMarkdown")}

## ${i18n.t("settings.connectionTarget")}

**${connection.title}**

${connection.detail}

## ${i18n.t("settings.connectionStatus")}

${connectionResult}

## ${i18n.t("settings.serverUrl")}

${codeBlock(serverUrl || i18n.t("settings.notConfigured"))}

## ${i18n.t("settings.apiToken")}

${hasApiToken ? i18n.t("settings.configuredDetail") : i18n.t("settings.notConfiguredDetail")}
`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title={i18n.t("settings.serverUrl")}
            text={serverUrl || i18n.t("settings.notConfigured")}
          />
          <Detail.Metadata.Label
            title={i18n.t("settings.apiToken")}
            text={hasApiToken ? i18n.t("settings.configured") : i18n.t("settings.notConfigured")}
          />
          <Detail.Metadata.Label title={i18n.t("settings.storageMode")} text={connection.title} />
          <Detail.Metadata.Label title={i18n.t("settings.recordsEndpoint")} text="/v1/records" />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action
            title={i18n.t("settings.editPreferences")}
            icon={Icon.Gear}
            onAction={() => void openExtensionPreferences()}
          />
          {serverUrl && hasApiToken && (
            <Action
              title={i18n.t("settings.checkConnection")}
              icon={Icon.Network}
              onAction={() => void checkConnection()}
            />
          )}
          {serverUrl && <Action.CopyToClipboard title={i18n.t("settings.copyServerUrl")} content={serverUrl} />}
        </ActionPanel>
      }
    />
  );
}

export default function ProductionContextSettingsCommand() {
  return <ContextSettingsCommand />;
}
