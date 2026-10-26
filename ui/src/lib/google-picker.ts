type PickerConfig = {
  accessToken: string;
  apiKey: string;
  appId: string | null;
};

type PickedDoc = { id: string; name?: string; url?: string };

type PickerView = {
  setMimeTypes(types: string): PickerView;
  setSelectFolderEnabled(on: boolean): PickerView;
  setIncludeFolders(on: boolean): PickerView;
  setOwnedByMe?(on: boolean): PickerView;
};

type PickerBuilder = {
  addView(view: PickerView): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (data: { action: string; docs?: PickedDoc[] }) => void): PickerBuilder;
  build(): { setVisible(on: boolean): void };
};

type GooglePickerNamespace = {
  DocsView: new (viewId: string) => PickerView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCUMENTS: string; FOLDERS: string };
  Feature: { SUPPORT_DRIVES: string };
  Action: { PICKED: string; CANCEL: string };
};

type PickerWindow = Window & {
  gapi?: { load(name: string, done: () => void): void };
  google?: { picker?: GooglePickerNamespace };
};

const SCRIPT = "https://apis.google.com/js/api.js";
let loading: Promise<GooglePickerNamespace> | null = null;

function loadPicker(): Promise<GooglePickerNamespace> {
  const win = window as PickerWindow;
  if (win.google?.picker) return Promise.resolve(win.google.picker);
  if (loading) return loading;
  loading = new Promise<GooglePickerNamespace>((resolve, reject) => {
    const ready = () =>
      win.gapi?.load("picker", () => {
        if (win.google?.picker) resolve(win.google.picker);
        else reject(new Error("Google Picker didn't load"));
      });
    if (win.gapi) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error("Couldn't load Google Picker"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export async function pickFromDrive(
  kind: "document" | "folder",
  config: PickerConfig,
): Promise<PickedDoc | null> {
  const picker = await loadPicker();
  return new Promise((resolve) => {
    const view =
      kind === "document"
        ? new picker.DocsView(picker.ViewId.DOCUMENTS).setMimeTypes(
            "application/vnd.google-apps.document",
          )
        : new picker.DocsView(picker.ViewId.FOLDERS)
            .setIncludeFolders(true)
            .setSelectFolderEnabled(true)
            .setMimeTypes("application/vnd.google-apps.folder");
    let builder = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setTitle(kind === "document" ? "Choose the template" : "Choose a folder")
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0] ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      });
    if (config.appId) builder = builder.setAppId(config.appId);
    builder.build().setVisible(true);
  });
}
