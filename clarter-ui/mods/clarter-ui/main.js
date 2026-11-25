// The Clarter UI layout (layouts/clarter-ui.json): every block but the pane headers is this mod,
// told which part it draws by props.role. Sizes and colours are the Figma file's, 1:1.
import { View } from "gpui-kit";
import { props } from "herdr";
import { Brand, Footer, Spaces } from "./sidebar.js";
import { Toolbar, StatusBar } from "./workspace.js";
import { Activity } from "./activity.js";

const ROLES = { brand: Brand, spaces: Spaces, footer: Footer, toolbar: Toolbar, status: StatusBar, activity: Activity };

export default class ClarterUi extends View {
    init(p, cx) {
        const Role = ROLES[p?.role ?? props()?.role] ?? Spaces;
        this.part = new Role();
        this.part.init?.(cx);
    }

    render(cx) {
        return this.part.render(cx);
    }
}
