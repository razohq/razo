import type { Page } from '@playwright/test';
import {
  Button,
  Checkbox,
  Combobox,
  DatePicker,
  Dialog,
  Editor,
  FileInput,
  Image,
  Input,
  Label,
  Link,
  Menu,
  RadioButton,
  Select,
  Slider,
  Switch,
  Table,
  Tabs,
  TextArea,
  Tooltip,
} from '../src';
import { DEMO_URL } from '../fixtures/demoUrl';

/** Page object for the Model Exporter, every control named for the narration. */
export class DemoPage {
  readonly filename: Input;
  readonly format: Select;
  readonly quality: RadioButton;
  readonly includeSupports: Checkbox;
  readonly exportButton: Button;
  readonly uploadButton: Button;
  readonly helpLink: Link;
  readonly status: Label;
  readonly helpSection: Label;
  readonly modelFile: FileInput;
  readonly scale: Slider;
  readonly scaleValue: Label;
  readonly notes: TextArea;
  readonly extraFormats: Select;
  readonly autoSave: Switch;
  readonly material: Combobox;
  readonly exportHistory: Table;
  readonly openConfirm: Button;
  readonly confirmDialog: Dialog;
  readonly settingsTabs: Tabs;
  readonly preview: Image;
  readonly deadline: DatePicker;
  readonly actionsMenu: Menu;
  readonly menuStatus: Label;
  readonly confirmYes: Button;
  readonly formatInfo: Tooltip;
  readonly description: Editor;
  readonly materialOption: Label;

  constructor(readonly page: Page) {
    this.filename = new Input(page, 'filename', 'Filename');
    this.format = new Select(page, 'format', 'Format');
    this.quality = new RadioButton(page, 'quality', 'Quality');
    this.includeSupports = new Checkbox(page, 'include-supports', 'Include supports');
    this.exportButton = new Button(page, 'export', 'Export');
    this.uploadButton = new Button(page, 'upload', 'Upload to cloud');
    this.helpLink = new Link(page, 'help-link', 'Help');
    this.status = new Label(page, 'status', 'Export status');
    this.helpSection = new Label(page, 'help-section', 'Help section');
    this.modelFile = new FileInput(page, 'model-file', 'Model file');
    this.scale = new Slider(page, 'scale', 'Scale');
    this.scaleValue = new Label(page, 'scale-value', 'Scale value');
    this.notes = new TextArea(page, 'notes', 'Notes');
    this.extraFormats = new Select(page, 'extra-formats', 'Also export as');
    this.autoSave = new Switch(page, 'auto-save', 'Auto-save');
    this.material = new Combobox(page, 'material', 'Material');
    this.exportHistory = new Table(page, 'export-history', 'Export history');
    this.openConfirm = new Button(page, 'open-confirm', 'Confirm export');
    this.confirmDialog = new Dialog(page, 'confirm-dialog', 'Confirm export');
    this.settingsTabs = new Tabs(page, 'settings-tabs', 'Settings');
    this.preview = new Image(page, 'preview', 'Model preview');
    this.deadline = new DatePicker(page, 'deadline', 'Deadline');
    this.actionsMenu = new Menu(page, 'actions-menu', 'Actions');
    this.menuStatus = new Label(page, 'menu-status', 'Menu status');
    this.confirmYes = new Button(page, 'confirm-yes', 'Yes, export', {
      within: this.confirmDialog,
    });
    this.formatInfo = new Tooltip(page, 'format-info', 'Format info');
    this.description = new Editor(page, 'description', 'Description');
    this.materialOption = new Label(page, 'material-option', 'Material option');
  }

  async goto() {
    await this.page.goto(DEMO_URL);
  }
}
