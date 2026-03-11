type PreviewFocusPayload = {
  sceneId: string;
  stopIndex: number;
};

const listeners = new Set<(payload: PreviewFocusPayload) => void>();

export const emitPreviewFocus = (payload: PreviewFocusPayload) => {
  for (const listener of listeners) {
    listener(payload);
  }
};

export const subscribePreviewFocus = (
  listener: (payload: PreviewFocusPayload) => void,
) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
