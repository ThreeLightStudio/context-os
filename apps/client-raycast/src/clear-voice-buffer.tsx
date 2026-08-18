import { Detail, showHUD, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { voiceCommand } from "./voice-capture-api";

export default function ClearVoiceBufferCommand() {
  const [message, setMessage] = useState("Clearing local audio buffer…");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void voiceCommand("clear")
      .then(() => {
        setMessage("The local audio buffer and pending transcription were deleted.");
        return showHUD("Voice buffer cleared");
      })
      .catch(async (reason) => {
        const error = reason instanceof Error ? reason.message : "Could not clear Voice Capture.";
        setMessage(error);
        await showToast({ style: Toast.Style.Failure, title: "Voice buffer를 삭제하지 못했습니다", message: error });
      });
  }, []);
  return <Detail isLoading={message === "Clearing local audio buffer…"} markdown={`# Voice Capture\n\n${message}`} />;
}
