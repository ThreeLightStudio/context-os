import { Detail, showHUD, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { voiceCommand } from "./voice-capture-api";

export default function StartVoiceCaptureCommand() {
  const [message, setMessage] = useState("Starting microphone…");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void voiceCommand("start")
      .then((result) => {
        setMessage(`Listening. Buffer contains ${Math.floor(result.bufferedSeconds)} seconds.`);
        return showHUD("Voice Capture started");
      })
      .catch(async (reason) => {
        const error = reason instanceof Error ? reason.message : "Could not start Voice Capture.";
        setMessage(error);
        await showToast({ style: Toast.Style.Failure, title: "Voice Capture를 시작하지 못했습니다", message: error });
      });
  }, []);
  return <Detail isLoading={message === "Starting microphone…"} markdown={`# Voice Capture\n\n${message}`} />;
}
