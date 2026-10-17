/**
 * @dml/runtime-dom — TSDML runtime type definitions.
 *
 * A `.tsdml` file compiles its `@{ ... }` template blocks into `e(tag, props,
 * children)` runtime calls. This file types that `e` function so the editor
 * gives the same experience as TSX:
 *
 *   - tag-name completion  → `e("div"` suggests every key of `IntrinsicElements`
 *   - attribute completion → `e("div", {` suggests `class`, `id`, `onClick`, ...
 *   - prop type checking   → `e("div", { onClick: 123 })` is an error
 *   - CSS completion       → `style` is typed via `csstype`
 *   - event typing         → `onClick` receives a typed `MouseEvent`
 *
 * The `DML` namespace mirrors Solid's `JSX` namespace (see
 * `solid-js/types/jsx.d.ts`), adapted for the `e()` call style. `IntrinsicElements`
 * maps every tag name to its attribute interface, and the generic `e` function
 * infers the props type from the tag literal.
 */

import * as csstype from "csstype";

/**
 * A value that may be a plain value or a reactive accessor. TSDML compiles
 * child-position expressions and function-valued props into `() => expr`
 * thunks, so every prop/child slot accepts either form.
 */
export type FunctionMaybe<T = unknown> = (() => T) | T;

/**
 * The element type produced by `e()`.
 *
 * Includes `FunctionMaybe` of the primitive shapes: the compiler wraps bare
 * child expressions (`{ count.read() }`) and function-valued props into
 * `() => expr` thunks, and children are emitted as an array — so every
 * array-element slot must accept reactive accessors too, not just the
 * top-level `children` parameter.
 */
export type Element =
  | Node
  | ArrayElement
  | FunctionMaybe<string | number | boolean | null | undefined>;

export interface ArrayElement extends Array<Element> {}

/** Children accepted by `e(tag, props, children)`. */
export type Children = Element | ArrayElement | FunctionMaybe<Element>;

export namespace DML {
  // ---- element / component plumbing (mirrors JSX.ElementClass etc.) ----

  interface ElementClass {
    // empty, libs can define requirements downstream
  }
  interface ElementAttributesProperty {
    // empty, libs can define requirements downstream
  }
  interface ElementChildrenAttribute {
    children: {};
  }

  // ---- event handlers ----

  type DOMElement = Element;

  interface EventHandler<T, E extends Event> {
    (e: E & { currentTarget: T; target: DOMElement }): void;
  }

  interface BoundEventHandler<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>,
  > {
    0: (data: any, ...e: Parameters<EHandler>) => void;
    1: any;
  }
  type EventHandlerUnion<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>,
  > = EHandler | BoundEventHandler<T, E, EHandler>;

  interface EventHandlerWithOptions<T, E extends Event, EHandler = EventHandler<T, E>>
    extends AddEventListenerOptions,
      EventListenerOptions {
    handleEvent: EHandler;
  }

  type EventHandlerWithOptionsUnion<
    T,
    E extends Event,
    EHandler extends EventHandler<T, any> = EventHandler<T, E>,
  > = EHandler | EventHandlerWithOptions<T, E, EHandler>;

  interface InputEventHandler<T, E extends InputEvent> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      },
    ): void;
  }
  type InputEventHandlerUnion<T, E extends InputEvent> = EventHandlerUnion<
    T,
    E,
    InputEventHandler<T, E>
  >;

  interface ChangeEventHandler<T, E extends Event> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      },
    ): void;
  }
  type ChangeEventHandlerUnion<T, E extends Event> = EventHandlerUnion<
    T,
    E,
    ChangeEventHandler<T, E>
  >;

  interface FocusEventHandler<T, E extends FocusEvent> {
    (
      e: E & {
        currentTarget: T;
        target: T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          ? T
          : DOMElement;
      },
    ): void;
  }
  type FocusEventHandlerUnion<T, E extends FocusEvent> = EventHandlerUnion<
    T,
    E,
    FocusEventHandler<T, E>
  >;

  // ---- CSS ----

  interface CSSProperties extends csstype.PropertiesHyphen {
    // Override: allow arbitrary custom properties
    [key: `-${string}`]: string | number | undefined;
  }

  // ---- common attributes ----

  interface CustomAttributes<T> {
    ref?: T | ((el: T) => void) | undefined;
    children?: Element | undefined;
    classList?: { [k: string]: boolean | undefined } | undefined;
    key?: string | number | undefined;
    $ServerOnly?: boolean | undefined;
  }

  // ---- directives, explicit prop/attr/bool, custom events ----
  //
  // These are the "beyond TSX" features. TSX has no notion of directives,
  // explicit property/attribute/bool binding, or typed custom events. Solid
  // pioneered them; we ship them typed out of the box. Users augment the
  // empty interfaces below via declaration merging to add their own.

  type Accessor<T> = () => T;

  /** Augment to add typed directives, e.g. `clickOutside: (el, accessor) => void`. */
  interface Directives {}

  interface DirectiveFunctions {
    [x: string]: (el: DOMElement, accessor: Accessor<any>) => void;
  }

  /** Augment to add explicit property bindings, e.g. `value: string`. */
  interface ExplicitProperties {}

  /** Augment to add explicit attribute bindings, e.g. `href: string`. */
  interface ExplicitAttributes {}

  /** Augment to add explicit boolean attribute bindings, e.g. `disabled: boolean`. */
  interface ExplicitBoolAttributes {}

  /** Augment to add typed custom events, e.g. `myEvent: CustomEvent<MyDetail>`. */
  interface CustomEvents {}

  /** @deprecated Replaced by CustomEvents */
  interface CustomCaptureEvents {}

  type DirectiveAttributes = {
    [Key in keyof Directives as `use:${Key}`]?: Directives[Key];
  };
  type DirectiveFunctionAttributes<T> = {
    [K in keyof DirectiveFunctions as string extends K
      ? never
      : `use:${K}`]?: DirectiveFunctions[K] extends (
      el: infer E,
      ...rest: infer R
    ) => void
      ? T extends E
        ? R extends [infer A]
          ? A extends Accessor<infer V>
            ? V
            : never
          : true
        : never
      : never;
  };
  type PropAttributes = {
    [Key in keyof ExplicitProperties as `prop:${Key}`]?: ExplicitProperties[Key];
  };
  type AttrAttributes = {
    [Key in keyof ExplicitAttributes as `attr:${Key}`]?: ExplicitAttributes[Key];
  };
  type BoolAttributes = {
    [Key in keyof ExplicitBoolAttributes as `bool:${Key}`]?: ExplicitBoolAttributes[Key];
  };
  type OnAttributes<T> = {
    [Key in keyof CustomEvents as `on:${Key}`]?: EventHandlerWithOptionsUnion<
      T,
      CustomEvents[Key]
    >;
  };
  type OnCaptureAttributes<T> = {
    [Key in keyof CustomCaptureEvents as `oncapture:${Key}`]?: EventHandler<
      T,
      CustomCaptureEvents[Key]
    >;
  };

  interface AriaAttributes {
    "aria-activedescendant"?: string | undefined;
    "aria-atomic"?: boolean | "false" | "true" | undefined;
    "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined;
    "aria-busy"?: boolean | "false" | "true" | undefined;
    "aria-checked"?: boolean | "false" | "mixed" | "true" | undefined;
    "aria-colcount"?: number | string | undefined;
    "aria-colindex"?: number | string | undefined;
    "aria-colspan"?: number | string | undefined;
    "aria-controls"?: string | undefined;
    "aria-current"?:
      | boolean
      | "false"
      | "true"
      | "page"
      | "step"
      | "location"
      | "date"
      | "time"
      | undefined;
    "aria-describedby"?: string | undefined;
    "aria-details"?: string | undefined;
    "aria-disabled"?: boolean | "false" | "true" | undefined;
    "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup" | undefined;
    "aria-errormessage"?: string | undefined;
    "aria-expanded"?: boolean | "false" | "true" | undefined;
    "aria-flowto"?: string | undefined;
    "aria-grabbed"?: boolean | "false" | "true" | undefined;
    "aria-haspopup"?:
      | boolean
      | "false"
      | "true"
      | "menu"
      | "listbox"
      | "tree"
      | "grid"
      | "dialog"
      | undefined;
    "aria-hidden"?: boolean | "false" | "true" | undefined;
    "aria-invalid"?: boolean | "false" | "true" | "grammar" | "spelling" | undefined;
    "aria-keyshortcuts"?: string | undefined;
    "aria-label"?: string | undefined;
    "aria-labelledby"?: string | undefined;
    "aria-level"?: number | string | undefined;
    "aria-live"?: "off" | "assertive" | "polite" | undefined;
    "aria-modal"?: boolean | "false" | "true" | undefined;
    "aria-multiline"?: boolean | "false" | "true" | undefined;
    "aria-multiselectable"?: boolean | "false" | "true" | undefined;
    "aria-orientation"?: "horizontal" | "vertical" | undefined;
    "aria-owns"?: string | undefined;
    "aria-placeholder"?: string | undefined;
    "aria-posinset"?: number | string | undefined;
    "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined;
    "aria-readonly"?: boolean | "false" | "true" | undefined;
    "aria-relevant"?:
      | "additions"
      | "additions removals"
      | "additions text"
      | "all"
      | "removals"
      | "removals additions"
      | "removals text"
      | "text"
      | "text additions"
      | "text removals"
      | undefined;
    "aria-required"?: boolean | "false" | "true" | undefined;
    "aria-roledescription"?: string | undefined;
    "aria-rowcount"?: number | string | undefined;
    "aria-rowindex"?: number | string | undefined;
    "aria-rowspan"?: number | string | undefined;
    "aria-selected"?: boolean | "false" | "true" | undefined;
    "aria-setsize"?: number | string | undefined;
    "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined;
    "aria-valuemax"?: number | string | undefined;
    "aria-valuemin"?: number | string | undefined;
    "aria-valuenow"?: number | string | undefined;
    "aria-valuetext"?: string | undefined;
    role?:
      | "alert"
      | "alertdialog"
      | "application"
      | "article"
      | "banner"
      | "button"
      | "cell"
      | "checkbox"
      | "columnheader"
      | "combobox"
      | "complementary"
      | "contentinfo"
      | "definition"
      | "dialog"
      | "directory"
      | "document"
      | "feed"
      | "figure"
      | "form"
      | "grid"
      | "gridcell"
      | "group"
      | "heading"
      | "img"
      | "link"
      | "list"
      | "listbox"
      | "listitem"
      | "log"
      | "main"
      | "marquee"
      | "math"
      | "menu"
      | "menubar"
      | "menuitem"
      | "menuitemcheckbox"
      | "menuitemradio"
      | "navigation"
      | "none"
      | "note"
      | "option"
      | "presentation"
      | "progressbar"
      | "radio"
      | "radiogroup"
      | "region"
      | "row"
      | "rowgroup"
      | "rowheader"
      | "scrollbar"
      | "search"
      | "searchbox"
      | "separator"
      | "slider"
      | "spinbutton"
      | "status"
      | "switch"
      | "tab"
      | "table"
      | "tablist"
      | "tabpanel"
      | "term"
      | "textbox"
      | "timer"
      | "toolbar"
      | "tooltip"
      | "tree"
      | "treegrid"
      | "treeitem"
      | (string & {})
      | undefined;
  }

  interface DOMAttributes<T>
    extends CustomAttributes<T>,
      AriaAttributes,
      CustomEventHandlersCamelCase<T>,
      CustomEventHandlersLowerCase<T>,
      CustomEventHandlersNamespaced<T>,
      DirectiveAttributes,
      DirectiveFunctionAttributes<T>,
      PropAttributes,
      AttrAttributes,
      BoolAttributes,
      OnAttributes<T>,
      OnCaptureAttributes<T> {
    // properties
    innerHTML?: string;
    textContent?: string | number;

    // attributes
    autofocus?: boolean | undefined;
    class?: string | undefined;
    id?: string | undefined;
    nonce?: string | undefined;
    slot?: string | undefined;
    style?: CSSProperties | string | undefined;
    tabindex?: number | string | undefined;
    tabIndex?: number | string | undefined;

    // arbitrary data attributes — TSX does not complete these
    [key: `data-${string}`]: string | number | boolean | undefined;
  }

  // ---- global event handlers (camelCase) ----

  interface CustomEventHandlersCamelCase<T> {
    onAbort?: EventHandlerUnion<T, UIEvent> | undefined;
    onAnimationCancel?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationEnd?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationIteration?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAnimationStart?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onAuxClick?: EventHandlerUnion<T, PointerEvent> | undefined;
    onBeforeInput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onBlur?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onCancel?: EventHandlerUnion<T, Event> | undefined;
    onCanPlay?: EventHandlerUnion<T, Event> | undefined;
    onCanPlayThrough?: EventHandlerUnion<T, Event> | undefined;
    onChange?: ChangeEventHandlerUnion<T, Event> | undefined;
    onClick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onClose?: EventHandlerUnion<T, Event> | undefined;
    onCompositionEnd?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onCompositionStart?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onCompositionUpdate?: EventHandlerUnion<T, CompositionEvent> | undefined;
    onContextMenu?: EventHandlerUnion<T, PointerEvent> | undefined;
    onCopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onCut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onDblClick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onDrag?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragEnd?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragEnter?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragExit?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragLeave?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragOver?: EventHandlerUnion<T, DragEvent> | undefined;
    onDragStart?: EventHandlerUnion<T, DragEvent> | undefined;
    onDrop?: EventHandlerUnion<T, DragEvent> | undefined;
    onDurationChange?: EventHandlerUnion<T, Event> | undefined;
    onEmptied?: EventHandlerUnion<T, Event> | undefined;
    onEnded?: EventHandlerUnion<T, Event> | undefined;
    onError?: EventHandlerUnion<T, ErrorEvent> | undefined;
    onFocus?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFocusIn?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFocusOut?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onFormData?: EventHandlerUnion<T, FormDataEvent> | undefined;
    onFullscreenChange?: EventHandlerUnion<T, Event> | undefined;
    onFullscreenError?: EventHandlerUnion<T, Event> | undefined;
    onGotPointerCapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onInput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onInvalid?: EventHandlerUnion<T, Event> | undefined;
    onKeyDown?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onKeyPress?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onKeyUp?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onLoad?: EventHandlerUnion<T, Event> | undefined;
    onLoadedData?: EventHandlerUnion<T, Event> | undefined;
    onLoadedMetadata?: EventHandlerUnion<T, Event> | undefined;
    onLoadStart?: EventHandlerUnion<T, Event> | undefined;
    onLostPointerCapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onMouseDown?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseEnter?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseLeave?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseMove?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseOut?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseOver?: EventHandlerUnion<T, MouseEvent> | undefined;
    onMouseUp?: EventHandlerUnion<T, MouseEvent> | undefined;
    onPaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onPause?: EventHandlerUnion<T, Event> | undefined;
    onPlay?: EventHandlerUnion<T, Event> | undefined;
    onPlaying?: EventHandlerUnion<T, Event> | undefined;
    onPointerCancel?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerDown?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerEnter?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerLeave?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerMove?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerOut?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerOver?: EventHandlerUnion<T, PointerEvent> | undefined;
    onPointerUp?: EventHandlerUnion<T, PointerEvent> | undefined;
    onProgress?: EventHandlerUnion<T, ProgressEvent> | undefined;
    onRateChange?: EventHandlerUnion<T, Event> | undefined;
    onReset?: EventHandlerUnion<T, Event> | undefined;
    onResize?: EventHandlerUnion<T, UIEvent> | undefined;
    onScroll?: EventHandlerUnion<T, Event> | undefined;
    onScrollEnd?: EventHandlerUnion<T, Event> | undefined;
    onSecurityPolicyViolation?: EventHandlerUnion<T, SecurityPolicyViolationEvent> | undefined;
    onSeeked?: EventHandlerUnion<T, Event> | undefined;
    onSeeking?: EventHandlerUnion<T, Event> | undefined;
    onSelect?: EventHandlerUnion<T, Event> | undefined;
    onSelectionChange?: EventHandlerUnion<T, Event> | undefined;
    onSelectStart?: EventHandlerUnion<T, Event> | undefined;
    onSlotChange?: EventHandlerUnion<T, Event> | undefined;
    onStalled?: EventHandlerUnion<T, Event> | undefined;
    onSubmit?: EventHandlerUnion<T, SubmitEvent> | undefined;
    onSuspend?: EventHandlerUnion<T, Event> | undefined;
    onTimeUpdate?: EventHandlerUnion<T, Event> | undefined;
    onToggle?: EventHandlerUnion<T, Event> | undefined;
    onTouchCancel?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchEnd?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchMove?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTouchStart?: EventHandlerUnion<T, TouchEvent> | undefined;
    onTransitionCancel?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionEnd?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionRun?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onTransitionStart?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onVolumeChange?: EventHandlerUnion<T, Event> | undefined;
    onWaiting?: EventHandlerUnion<T, Event> | undefined;
    onWheel?: EventHandlerUnion<T, WheelEvent> | undefined;
  }

  // ---- global event handlers (lowercase) ----

  interface CustomEventHandlersLowerCase<T> {
    onabort?: EventHandlerUnion<T, UIEvent> | undefined;
    onanimationcancel?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onanimationend?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onanimationiteration?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onanimationstart?: EventHandlerUnion<T, AnimationEvent> | undefined;
    onauxclick?: EventHandlerUnion<T, PointerEvent> | undefined;
    onbeforeinput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    onblur?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    oncancel?: EventHandlerUnion<T, Event> | undefined;
    oncanplay?: EventHandlerUnion<T, Event> | undefined;
    oncanplaythrough?: EventHandlerUnion<T, Event> | undefined;
    onchange?: ChangeEventHandlerUnion<T, Event> | undefined;
    onclick?: EventHandlerUnion<T, MouseEvent> | undefined;
    onclose?: EventHandlerUnion<T, Event> | undefined;
    oncompositionend?: EventHandlerUnion<T, CompositionEvent> | undefined;
    oncompositionstart?: EventHandlerUnion<T, CompositionEvent> | undefined;
    oncompositionupdate?: EventHandlerUnion<T, CompositionEvent> | undefined;
    oncontextmenu?: EventHandlerUnion<T, PointerEvent> | undefined;
    oncopy?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    oncut?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    ondblclick?: EventHandlerUnion<T, MouseEvent> | undefined;
    ondrag?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragend?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragenter?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragexit?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragleave?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragover?: EventHandlerUnion<T, DragEvent> | undefined;
    ondragstart?: EventHandlerUnion<T, DragEvent> | undefined;
    ondrop?: EventHandlerUnion<T, DragEvent> | undefined;
    ondurationchange?: EventHandlerUnion<T, Event> | undefined;
    onemptied?: EventHandlerUnion<T, Event> | undefined;
    onended?: EventHandlerUnion<T, Event> | undefined;
    onerror?: EventHandlerUnion<T, ErrorEvent> | undefined;
    onfocus?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onfocusin?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onfocusout?: FocusEventHandlerUnion<T, FocusEvent> | undefined;
    onformdata?: EventHandlerUnion<T, FormDataEvent> | undefined;
    onfullscreenchange?: EventHandlerUnion<T, Event> | undefined;
    onfullscreenerror?: EventHandlerUnion<T, Event> | undefined;
    ongotpointercapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    oninput?: InputEventHandlerUnion<T, InputEvent> | undefined;
    oninvalid?: EventHandlerUnion<T, Event> | undefined;
    onkeydown?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onkeypress?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onkeyup?: EventHandlerUnion<T, KeyboardEvent> | undefined;
    onload?: EventHandlerUnion<T, Event> | undefined;
    onloadeddata?: EventHandlerUnion<T, Event> | undefined;
    onloadedmetadata?: EventHandlerUnion<T, Event> | undefined;
    onloadstart?: EventHandlerUnion<T, Event> | undefined;
    onlostpointercapture?: EventHandlerUnion<T, PointerEvent> | undefined;
    onmousedown?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseenter?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseleave?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmousemove?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseout?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseover?: EventHandlerUnion<T, MouseEvent> | undefined;
    onmouseup?: EventHandlerUnion<T, MouseEvent> | undefined;
    onpaste?: EventHandlerUnion<T, ClipboardEvent> | undefined;
    onpause?: EventHandlerUnion<T, Event> | undefined;
    onplay?: EventHandlerUnion<T, Event> | undefined;
    onplaying?: EventHandlerUnion<T, Event> | undefined;
    onpointercancel?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerdown?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerenter?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerleave?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointermove?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerout?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerover?: EventHandlerUnion<T, PointerEvent> | undefined;
    onpointerup?: EventHandlerUnion<T, PointerEvent> | undefined;
    onprogress?: EventHandlerUnion<T, ProgressEvent> | undefined;
    onratechange?: EventHandlerUnion<T, Event> | undefined;
    onreset?: EventHandlerUnion<T, Event> | undefined;
    onresize?: EventHandlerUnion<T, UIEvent> | undefined;
    onscroll?: EventHandlerUnion<T, Event> | undefined;
    onscrollend?: EventHandlerUnion<T, Event> | undefined;
    onsecuritypolicyviolation?: EventHandlerUnion<T, SecurityPolicyViolationEvent> | undefined;
    onseeked?: EventHandlerUnion<T, Event> | undefined;
    onseeking?: EventHandlerUnion<T, Event> | undefined;
    onselect?: EventHandlerUnion<T, Event> | undefined;
    onselectionchange?: EventHandlerUnion<T, Event> | undefined;
    onselectstart?: EventHandlerUnion<T, Event> | undefined;
    onslotchange?: EventHandlerUnion<T, Event> | undefined;
    onstalled?: EventHandlerUnion<T, Event> | undefined;
    onsubmit?: EventHandlerUnion<T, SubmitEvent> | undefined;
    onsuspend?: EventHandlerUnion<T, Event> | undefined;
    ontimeupdate?: EventHandlerUnion<T, Event> | undefined;
    ontoggle?: EventHandlerUnion<T, Event> | undefined;
    ontouchcancel?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontouchend?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontouchmove?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontouchstart?: EventHandlerUnion<T, TouchEvent> | undefined;
    ontransitioncancel?: EventHandlerUnion<T, TransitionEvent> | undefined;
    ontransitionend?: EventHandlerUnion<T, TransitionEvent> | undefined;
    ontransitionrun?: EventHandlerUnion<T, TransitionEvent> | undefined;
    ontransitionstart?: EventHandlerUnion<T, TransitionEvent> | undefined;
    onvolumechange?: EventHandlerUnion<T, Event> | undefined;
    onwaiting?: EventHandlerUnion<T, Event> | undefined;
    onwheel?: EventHandlerUnion<T, WheelEvent> | undefined;
  }

  // ---- namespaced event handlers (on:click) ----

  interface CustomEventHandlersNamespaced<T> {
    "on:abort"?: EventHandlerWithOptionsUnion<T, UIEvent> | undefined;
    "on:animationcancel"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationend"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationiteration"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:animationstart"?: EventHandlerWithOptionsUnion<T, AnimationEvent> | undefined;
    "on:auxclick"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:beforeinput"?:
      | EventHandlerWithOptionsUnion<T, InputEvent, InputEventHandler<T, InputEvent>>
      | undefined;
    "on:blur"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:cancel"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:canplay"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:canplaythrough"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:change"?: EventHandlerWithOptionsUnion<T, Event, ChangeEventHandler<T, Event>> | undefined;
    "on:click"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:close"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:compositionend"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:compositionstart"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:compositionupdate"?: EventHandlerWithOptionsUnion<T, CompositionEvent> | undefined;
    "on:contextmenu"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:copy"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:cut"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:dblclick"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:drag"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragend"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragenter"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragexit"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragleave"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragover"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:dragstart"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:drop"?: EventHandlerWithOptionsUnion<T, DragEvent> | undefined;
    "on:durationchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:emptied"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:ended"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:error"?: EventHandlerWithOptionsUnion<T, ErrorEvent> | undefined;
    "on:focus"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:focusin"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:focusout"?:
      | EventHandlerWithOptionsUnion<T, FocusEvent, FocusEventHandler<T, FocusEvent>>
      | undefined;
    "on:formdata"?: EventHandlerWithOptionsUnion<T, FormDataEvent> | undefined;
    "on:fullscreenchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:fullscreenerror"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:gotpointercapture"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:input"?:
      | EventHandlerWithOptionsUnion<T, InputEvent, InputEventHandler<T, InputEvent>>
      | undefined;
    "on:invalid"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:keydown"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:keypress"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:keyup"?: EventHandlerWithOptionsUnion<T, KeyboardEvent> | undefined;
    "on:load"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadeddata"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadedmetadata"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:loadstart"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:lostpointercapture"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:mousedown"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseenter"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseleave"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mousemove"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseout"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseover"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:mouseup"?: EventHandlerWithOptionsUnion<T, MouseEvent> | undefined;
    "on:paste"?: EventHandlerWithOptionsUnion<T, ClipboardEvent> | undefined;
    "on:pause"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:play"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:playing"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:pointercancel"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerdown"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerenter"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerleave"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointermove"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerout"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerover"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:pointerup"?: EventHandlerWithOptionsUnion<T, PointerEvent> | undefined;
    "on:progress"?: EventHandlerWithOptionsUnion<T, ProgressEvent> | undefined;
    "on:ratechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:reset"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:resize"?: EventHandlerWithOptionsUnion<T, UIEvent> | undefined;
    "on:scroll"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:scrollend"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:securitypolicyviolation"?:
      | EventHandlerWithOptionsUnion<T, SecurityPolicyViolationEvent>
      | undefined;
    "on:seeked"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:seeking"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:select"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:selectionchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:selectstart"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:slotchange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:stalled"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:submit"?: EventHandlerWithOptionsUnion<T, SubmitEvent> | undefined;
    "on:suspend"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:timeupdate"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:toggle"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:touchcancel"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchend"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchmove"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:touchstart"?: EventHandlerWithOptionsUnion<T, TouchEvent> | undefined;
    "on:transitioncancel"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionend"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionrun"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:transitionstart"?: EventHandlerWithOptionsUnion<T, TransitionEvent> | undefined;
    "on:volumechange"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:waiting"?: EventHandlerWithOptionsUnion<T, Event> | undefined;
    "on:wheel"?: EventHandlerWithOptionsUnion<T, WheelEvent> | undefined;
  }

  // ---- HTML attributes ----

  type HTMLAutocapitalize = "off" | "none" | "on" | "sentences" | "words" | "characters";
  type HTMLDir = "ltr" | "rtl" | "auto";
  type HTMLFormEncType = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
  type HTMLFormMethod = "post" | "get" | "dialog";
  type HTMLCrossorigin = "anonymous" | "use-credentials" | "";
  type HTMLReferrerPolicy =
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";

  interface HTMLAttributes<T> extends DOMAttributes<T> {
    innerText?: string | number;

    accesskey?: string | undefined;
    autocapitalize?: HTMLAutocapitalize | undefined;
    autocorrect?: "on" | "off" | undefined;
    contenteditable?: "true" | "false" | boolean | "plaintext-only" | "inherit" | undefined;
    dir?: HTMLDir | undefined;
    draggable?: boolean | "false" | "true" | undefined;
    enterkeyhint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined;
    exportparts?: string | undefined;
    hidden?: boolean | "hidden" | "until-found" | undefined;
    inert?: boolean | undefined;
    inputmode?:
      | "decimal"
      | "email"
      | "none"
      | "numeric"
      | "search"
      | "tel"
      | "text"
      | "url"
      | undefined;
    is?: string | undefined;
    lang?: string | undefined;
    part?: string | undefined;
    popover?: boolean | "manual" | "auto" | undefined;
    spellcheck?: "true" | "false" | boolean | undefined;
    title?: string | undefined;
    translate?: "yes" | "no" | undefined;

    accessKey?: string | undefined;
    autoCapitalize?: HTMLAutocapitalize | undefined;
    contentEditable?: boolean | "plaintext-only" | "inherit" | undefined;
    exportParts?: string | undefined;
    inputMode?:
      | "none"
      | "text"
      | "tel"
      | "url"
      | "email"
      | "numeric"
      | "decimal"
      | "search"
      | undefined;

    // Microdata
    itemid?: string | undefined;
    itemprop?: string | undefined;
    itemref?: string | undefined;
    itemscope?: boolean | undefined;
    itemtype?: string | undefined;
    itemId?: string | undefined;
    itemProp?: string | undefined;
    itemRef?: string | undefined;
    itemScope?: boolean | undefined;
    itemType?: string | undefined;

    // RDFa
    about?: string | undefined;
    datatype?: string | undefined;
    inlist?: any | undefined;
    prefix?: string | undefined;
    property?: string | undefined;
    resource?: string | undefined;
    typeof?: string | undefined;
    vocab?: string | undefined;

    /** @deprecated */
    contextmenu?: string | undefined;
    /** @deprecated */
    contextMenu?: string | undefined;
  }

  // ---- per-element HTML attributes ----

  interface AnchorHTMLAttributes<T> extends HTMLAttributes<T> {
    download?: string | undefined;
    href?: string | undefined;
    hreflang?: string | undefined;
    ping?: string | undefined;
    referrerpolicy?: HTMLReferrerPolicy | undefined;
    rel?: string | undefined;
    target?: "_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined;
    type?: string | undefined;
    referrerPolicy?: HTMLReferrerPolicy | undefined;
    /** @deprecated */
    charset?: string | undefined;
    /** @deprecated */
    coords?: string | undefined;
    /** @deprecated */
    name?: string | undefined;
    /** @deprecated */
    rev?: string | undefined;
    /** @deprecated */
    shape?: "rect" | "circle" | "poly" | "default" | undefined;
  }
  interface AudioHTMLAttributes<T> extends MediaHTMLAttributes<T> {}
  interface BdoHTMLAttributes<T> extends HTMLAttributes<T> {
    dir?: HTMLDir | undefined;
  }
  interface CaptionHTMLAttributes<T> extends HTMLAttributes<T> {
    align?: string | undefined;
  }
  interface DelHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: string | undefined;
    datetime?: string | undefined;
  }
  interface InsHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: string | undefined;
    datetime?: string | undefined;
  }
  interface AreaHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: string | undefined;
    coords?: string | undefined;
    download?: string | undefined;
    href?: string | undefined;
    ping?: string | undefined;
    referrerpolicy?: HTMLReferrerPolicy | undefined;
    rel?: string | undefined;
    shape?: "rect" | "circle" | "poly" | "default" | undefined;
    target?: "_self" | "_blank" | "_parent" | "_top" | (string & {}) | undefined;
    referrerPolicy?: HTMLReferrerPolicy | undefined;
  }
  interface BaseHTMLAttributes<T> extends HTMLAttributes<T> {
    href?: string | undefined;
    target?: string | undefined;
  }
  interface BlockquoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: string | undefined;
  }
  interface BodyHTMLAttributes<T> extends HTMLAttributes<T> {
    alink?: string | undefined;
    background?: string | undefined;
    bgcolor?: string | undefined;
    link?: string | undefined;
    text?: string | undefined;
    vlink?: string | undefined;
  }
  interface ButtonHTMLAttributes<T> extends HTMLAttributes<T> {
    autofocus?: boolean | undefined;
    disabled?: boolean | undefined;
    form?: string | undefined;
    formaction?: string | undefined;
    formenctype?: HTMLFormEncType | undefined;
    formmethod?: HTMLFormMethod | undefined;
    formnovalidate?: boolean | undefined;
    formtarget?: string | undefined;
    name?: string | undefined;
    type?: "submit" | "reset" | "button" | undefined;
    value?: string | string[] | number | undefined;
  }
  interface CanvasHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: number | string | undefined;
    width?: number | string | undefined;
  }
  interface ColHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: number | undefined;
    width?: number | string | undefined;
  }
  interface ColgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    span?: number | undefined;
  }
  interface DataHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: string | string[] | number | undefined;
  }
  interface DetailsHTMLAttributes<T> extends HTMLAttributes<T> {
    open?: boolean | undefined;
  }
  interface DialogHTMLAttributes<T> extends HTMLAttributes<T> {
    open?: boolean | undefined;
  }
  interface EmbedHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: number | string | undefined;
    src?: string | undefined;
    type?: string | undefined;
    width?: number | string | undefined;
  }
  interface FieldsetHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: boolean | undefined;
    form?: string | undefined;
    name?: string | undefined;
  }
  interface FormHTMLAttributes<T> extends HTMLAttributes<T> {
    acceptcharset?: string | undefined;
    action?: string | undefined;
    autocomplete?: string | undefined;
    enctype?: HTMLFormEncType | undefined;
    method?: HTMLFormMethod | undefined;
    name?: string | undefined;
    novalidate?: boolean | undefined;
    target?: string | undefined;
  }
  interface HtmlHTMLAttributes<T> extends HTMLAttributes<T> {
    manifest?: string | undefined;
  }
  interface IframeHTMLAttributes<T> extends HTMLAttributes<T> {
    allow?: string | undefined;
    allowfullscreen?: boolean | undefined;
    height?: number | string | undefined;
    loading?: "eager" | "lazy" | undefined;
    name?: string | undefined;
    referrerpolicy?: HTMLReferrerPolicy | undefined;
    sandbox?: string | undefined;
    src?: string | undefined;
    srcdoc?: string | undefined;
    width?: number | string | undefined;
  }
  interface ImgHTMLAttributes<T> extends HTMLAttributes<T> {
    alt?: string | undefined;
    crossorigin?: HTMLCrossorigin | undefined;
    decoding?: "async" | "auto" | "sync" | undefined;
    height?: number | string | undefined;
    ismap?: boolean | undefined;
    loading?: "eager" | "lazy" | undefined;
    referrerpolicy?: HTMLReferrerPolicy | undefined;
    sizes?: string | undefined;
    src?: string | undefined;
    srcset?: string | undefined;
    usemap?: string | undefined;
    width?: number | string | undefined;
  }
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    accept?: string | undefined;
    alt?: string | undefined;
    autocomplete?: string | undefined;
    capture?: boolean | string | undefined;
    checked?: boolean | undefined;
    crossorigin?: HTMLCrossorigin | undefined;
    dirname?: string | undefined;
    disabled?: boolean | undefined;
    form?: string | undefined;
    formaction?: string | undefined;
    formenctype?: HTMLFormEncType | undefined;
    formmethod?: HTMLFormMethod | undefined;
    formnovalidate?: boolean | undefined;
    formtarget?: string | undefined;
    height?: number | string | undefined;
    list?: string | undefined;
    max?: number | string | undefined;
    maxlength?: number | undefined;
    min?: number | string | undefined;
    minlength?: number | undefined;
    multiple?: boolean | undefined;
    name?: string | undefined;
    pattern?: string | undefined;
    placeholder?: string | undefined;
    readonly?: boolean | undefined;
    required?: boolean | undefined;
    size?: number | undefined;
    src?: string | undefined;
    step?: number | string | undefined;
    type?: string | undefined;
    value?: string | string[] | number | undefined;
    width?: number | string | undefined;
  }
  interface KeygenHTMLAttributes<T> extends HTMLAttributes<T> {
    challenge?: string | undefined;
    disabled?: boolean | undefined;
    form?: string | undefined;
    keytype?: string | undefined;
    name?: string | undefined;
  }
  interface LabelHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: string | undefined;
    for?: string | undefined;
    htmlFor?: string | undefined;
  }
  interface LiHTMLAttributes<T> extends HTMLAttributes<T> {
    value?: string | string[] | number | undefined;
  }
  interface LinkHTMLAttributes<T> extends HTMLAttributes<T> {
    as?: string | undefined;
    crossorigin?: HTMLCrossorigin | undefined;
    disabled?: boolean | undefined;
    href?: string | undefined;
    hreflang?: string | undefined;
    imagesizes?: string | undefined;
    imagesrcset?: string | undefined;
    integrity?: string | undefined;
    media?: string | undefined;
    referrerpolicy?: HTMLReferrerPolicy | undefined;
    rel?: string | undefined;
    sizes?: string | undefined;
    type?: string | undefined;
  }
  interface MapHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: string | undefined;
  }
  interface MediaHTMLAttributes<T> extends HTMLAttributes<T> {
    autoplay?: boolean | undefined;
    controls?: boolean | undefined;
    controlslist?: string | undefined;
    crossorigin?: HTMLCrossorigin | undefined;
    loop?: boolean | undefined;
    mediagroup?: string | undefined;
    muted?: boolean | undefined;
    playsinline?: boolean | undefined;
    preload?: string | undefined;
    src?: string | undefined;
  }
  interface MenuHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: string | undefined;
  }
  interface MetaHTMLAttributes<T> extends HTMLAttributes<T> {
    charset?: string | undefined;
    content?: string | undefined;
    "http-equiv"?: string | undefined;
    name?: string | undefined;
    media?: string | undefined;
  }
  interface MeterHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: string | undefined;
    high?: number | undefined;
    low?: number | undefined;
    max?: number | string | undefined;
    min?: number | string | undefined;
    optimum?: number | undefined;
    value?: string | string[] | number | undefined;
  }
  interface ObjectHTMLAttributes<T> extends HTMLAttributes<T> {
    classid?: string | undefined;
    data?: string | undefined;
    form?: string | undefined;
    height?: number | string | undefined;
    name?: string | undefined;
    type?: string | undefined;
    usemap?: string | undefined;
    width?: number | string | undefined;
  }
  interface OlHTMLAttributes<T> extends HTMLAttributes<T> {
    reversed?: boolean | undefined;
    start?: number | undefined;
    type?: "1" | "a" | "A" | "i" | "I" | undefined;
  }
  interface OptgroupHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: boolean | undefined;
    label?: string | undefined;
  }
  interface OptionHTMLAttributes<T> extends HTMLAttributes<T> {
    disabled?: boolean | undefined;
    label?: string | undefined;
    selected?: boolean | undefined;
    value?: string | string[] | number | undefined;
  }
  interface OutputHTMLAttributes<T> extends HTMLAttributes<T> {
    form?: string | undefined;
    for?: string | undefined;
    htmlFor?: string | undefined;
    name?: string | undefined;
  }
  interface ParamHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: string | undefined;
    value?: string | string[] | number | undefined;
  }
  interface ProgressHTMLAttributes<T> extends HTMLAttributes<T> {
    max?: number | string | undefined;
    value?: string | string[] | number | undefined;
  }
  interface QuoteHTMLAttributes<T> extends HTMLAttributes<T> {
    cite?: string | undefined;
  }
  interface ScriptHTMLAttributes<T> extends HTMLAttributes<T> {
    async?: boolean | undefined;
    crossorigin?: HTMLCrossorigin | undefined;
    defer?: boolean | undefined;
    integrity?: string | undefined;
    nomodule?: boolean | undefined;
    referrerpolicy?: HTMLReferrerPolicy | undefined;
    src?: string | undefined;
    type?: string | undefined;
  }
  interface SelectHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: string | undefined;
    disabled?: boolean | undefined;
    form?: string | undefined;
    multiple?: boolean | undefined;
    name?: string | undefined;
    required?: boolean | undefined;
    size?: number | undefined;
    value?: string | string[] | number | undefined;
  }
  interface SlotHTMLAttributes<T> extends HTMLAttributes<T> {
    name?: string | undefined;
  }
  interface SourceHTMLAttributes<T> extends HTMLAttributes<T> {
    height?: number | string | undefined;
    media?: string | undefined;
    sizes?: string | undefined;
    src?: string | undefined;
    srcset?: string | undefined;
    type?: string | undefined;
    width?: number | string | undefined;
  }
  interface StyleHTMLAttributes<T> extends HTMLAttributes<T> {
    media?: string | undefined;
    nonce?: string | undefined;
    scoped?: boolean | undefined;
    type?: string | undefined;
  }
  interface TableHTMLAttributes<T> extends HTMLAttributes<T> {
    cellpadding?: number | string | undefined;
    cellspacing?: number | string | undefined;
    summary?: string | undefined;
  }
  interface TdHTMLAttributes<T> extends HTMLAttributes<T> {
    colspan?: number | undefined;
    headers?: string | undefined;
    rowspan?: number | undefined;
  }
  interface TextareaHTMLAttributes<T> extends HTMLAttributes<T> {
    autocomplete?: string | undefined;
    cols?: number | undefined;
    dirname?: string | undefined;
    disabled?: boolean | undefined;
    form?: string | undefined;
    maxlength?: number | undefined;
    minlength?: number | undefined;
    name?: string | undefined;
    placeholder?: string | undefined;
    readonly?: boolean | undefined;
    required?: boolean | undefined;
    rows?: number | undefined;
    value?: string | string[] | number | undefined;
    wrap?: string | undefined;
  }
  interface ThHTMLAttributes<T> extends HTMLAttributes<T> {
    colspan?: number | undefined;
    headers?: string | undefined;
    rowspan?: number | undefined;
    scope?: string | undefined;
  }
  interface TimeHTMLAttributes<T> extends HTMLAttributes<T> {
    datetime?: string | undefined;
  }
  interface TrackHTMLAttributes<T> extends HTMLAttributes<T> {
    default?: boolean | undefined;
    kind?: string | undefined;
    label?: string | undefined;
    src?: string | undefined;
    srclang?: string | undefined;
  }
  interface VideoHTMLAttributes<T> extends MediaHTMLAttributes<T> {
    height?: number | string | undefined;
    playsinline?: boolean | undefined;
    poster?: string | undefined;
    width?: number | string | undefined;
  }

  // ---- SVG attributes ----

  interface CoreSVGAttributes<T> extends DOMAttributes<T> {
    id?: string | undefined;
    lang?: string | undefined;
    tabindex?: number | string | undefined;
    tabIndex?: number | string | undefined;
  }
  interface StylableSVGAttributes {
    class?: string | undefined;
    style?: CSSProperties | string | undefined;
  }
  interface TransformableSVGAttributes {
    transform?: string | undefined;
  }
  interface ConditionalProcessingSVGAttributes {
    requiredExtensions?: string | undefined;
    requiredFeatures?: string | undefined;
    systemLanguage?: string | undefined;
  }
  interface ExternalResourceSVGAttributes {
    externalResourcesRequired?: boolean | "true" | "false" | undefined;
  }
  interface AnimationTimingSVGAttributes {
    begin?: string | undefined;
    dur?: string | undefined;
    end?: string | undefined;
    min?: string | undefined;
    max?: string | undefined;
    restart?: "always" | "whenNotActive" | "never" | undefined;
    repeatCount?: number | string | undefined;
    repeatDur?: string | undefined;
    fill?: "freeze" | "remove" | undefined;
  }
  interface AnimationValueSVGAttributes {
    calcMode?: "discrete" | "linear" | "paced" | "spline" | undefined;
    values?: string | undefined;
    keyTimes?: string | undefined;
    keySplines?: string | undefined;
    from?: string | number | undefined;
    to?: string | number | undefined;
    by?: string | number | undefined;
  }
  interface AnimationAdditionSVGAttributes {
    additive?: "replace" | "sum" | undefined;
    accumulate?: "none" | "sum" | undefined;
  }
  interface AnimationAttributeTargetSVGAttributes {
    attributeName?: string | undefined;
    attributeType?: "CSS" | "XML" | undefined;
  }
  interface PresentationSVGAttributes {
    "alignment-baseline"?:
      | "auto"
      | "baseline"
      | "before-edge"
      | "text-before-edge"
      | "middle"
      | "central"
      | "after-edge"
      | "text-after-edge"
      | "ideographic"
      | "alphabetic"
      | "hanging"
      | "mathematical"
      | "inherit"
      | undefined;
    "baseline-shift"?: string | undefined;
    clip?: string | undefined;
    "clip-path"?: string | undefined;
    "clip-rule"?: "evenodd" | "nonzero" | "inherit" | undefined;
    color?: string | undefined;
    "color-interpolation"?: string | undefined;
    "color-interpolation-filters"?: "auto" | "sRGB" | "linearRGB" | "inherit" | undefined;
    "color-profile"?: string | undefined;
    "color-rendering"?: "auto" | "sRGB" | "optimizeSpeed" | "optimizeQuality" | "inherit" | undefined;
    cursor?: string | undefined;
    direction?: "ltr" | "rtl" | "inherit" | undefined;
    display?: string | undefined;
    "dominant-baseline"?:
      | "auto"
      | "use-script"
      | "no-change"
      | "reset-size"
      | "ideographic"
      | "alphabetic"
      | "hanging"
      | "mathematical"
      | "central"
      | "middle"
      | "text-after-edge"
      | "text-before-edge"
      | "inherit"
      | undefined;
    "enable-background"?: string | undefined;
    fill?: string | undefined;
    "fill-opacity"?: number | string | undefined;
    "fill-rule"?: "evenodd" | "nonzero" | "inherit" | undefined;
    filter?: string | undefined;
    "flood-color"?: string | undefined;
    "flood-opacity"?: number | string | undefined;
    "font-family"?: string | undefined;
    "font-size"?: string | undefined;
    "font-size-adjust"?: string | number | undefined;
    "font-stretch"?: string | undefined;
    "font-style"?: string | undefined;
    "font-variant"?: string | undefined;
    "font-weight"?: string | number | undefined;
    "glyph-orientation-horizontal"?: string | undefined;
    "glyph-orientation-vertical"?: string | undefined;
    "image-rendering"?: "auto" | "optimizeSpeed" | "optimizeQuality" | "inherit" | undefined;
    kerning?: string | undefined;
    "letter-spacing"?: string | undefined;
    "lighting-color"?: string | undefined;
    "marker-end"?: string | undefined;
    "marker-mid"?: string | undefined;
    "marker-start"?: string | undefined;
    mask?: string | undefined;
    opacity?: number | string | undefined;
    overflow?: string | undefined;
    "pointer-events"?: string | undefined;
    "shape-rendering"?: "auto" | "optimizeSpeed" | "crispEdges" | "geometricPrecision" | "inherit" | undefined;
    "stop-color"?: string | undefined;
    "stop-opacity"?: number | string | undefined;
    stroke?: string | undefined;
    "stroke-dasharray"?: string | undefined;
    "stroke-dashoffset"?: string | undefined;
    "stroke-linecap"?: "butt" | "round" | "square" | "inherit" | undefined;
    "stroke-linejoin"?: "miter" | "round" | "bevel" | "inherit" | undefined;
    "stroke-miterlimit"?: number | string | undefined;
    "stroke-opacity"?: number | string | undefined;
    "stroke-width"?: number | string | undefined;
    "text-anchor"?: "start" | "middle" | "end" | "inherit" | undefined;
    "text-decoration"?: string | undefined;
    "text-rendering"?: "auto" | "optimizeSpeed" | "optimizeLegibility" | "geometricPrecision" | "inherit" | undefined;
    "transform-origin"?: string | undefined;
    "unicode-bidi"?: string | undefined;
    "vector-effect"?: string | undefined;
    visibility?: string | undefined;
    "word-spacing"?: string | undefined;
    "writing-mode"?: string | undefined;
  }
  interface AnimationElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      ConditionalProcessingSVGAttributes {}
  interface ContainerElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "clip-path" | "mask" | "opacity" | "filter">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface FilterPrimitiveElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "color-interpolation-filters"> {}
  interface SingleInputFilterSVGAttributes {
    in?: string | undefined;
  }
  interface DoubleInputFilterSVGAttributes extends SingleInputFilterSVGAttributes {
    in2?: string | undefined;
  }
  interface FitToViewBoxSVGAttributes {
    viewBox?: string | undefined;
    preserveAspectRatio?: string | undefined;
  }
  interface GradientElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    gradientUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    gradientTransform?: string | undefined;
    spreadMethod?: "pad" | "reflect" | "repeat" | undefined;
    x1?: string | number | undefined;
    x2?: string | number | undefined;
    y1?: string | number | undefined;
    y2?: string | number | undefined;
  }
  interface GraphicsElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "clip-rule" | "mask" | "filter">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface LightSourceElementSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface NewViewportSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "overflow" | "clip"> {}
  interface ShapeElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "color" | "fill" | "stroke">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface TextContentElementSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "font-family" | "font-size" | "font-style" | "font-weight" | "text-anchor" | "text-decoration">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface ZoomAndPanSVGAttributes {
    zoomAndPan?: "disable" | "magnify" | undefined;
  }
  interface AnimateSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes,
      Pick<PresentationSVGAttributes, "color-interpolation" | "color-rendering"> {}
  interface AnimateMotionSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {}
  interface AnimateTransformSVGAttributes<T>
    extends AnimationElementSVGAttributes<T>,
      AnimationAttributeTargetSVGAttributes,
      AnimationTimingSVGAttributes,
      AnimationValueSVGAttributes,
      AnimationAdditionSVGAttributes {}
  interface CircleSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    cx?: string | number | undefined;
    cy?: string | number | undefined;
    r?: string | number | undefined;
  }
  interface ClipPathSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    clipPathUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
  }
  interface DefsSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes {}
  interface DescSVGAttributes<T> extends CoreSVGAttributes<T>, StylableSVGAttributes {}
  interface EllipseSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    cx?: string | number | undefined;
    cy?: string | number | undefined;
    rx?: string | number | undefined;
    ry?: string | number | undefined;
  }
  interface FeBlendSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    mode?: "normal" | "multiply" | "screen" | "darken" | "lighten" | undefined;
  }
  interface FeColorMatrixSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    type?: "matrix" | "saturate" | "hueRotate" | "luminanceToAlpha" | undefined;
    values?: string | undefined;
  }
  interface FeComponentTransferSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeCompositeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    operator?: "over" | "in" | "out" | "atop" | "xor" | "arithmetic" | undefined;
    k1?: number | string | undefined;
    k2?: number | string | undefined;
    k3?: number | string | undefined;
    k4?: number | string | undefined;
  }
  interface FeConvolveMatrixSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    order?: number | string | undefined;
    kernelMatrix?: string | undefined;
    divisor?: number | string | undefined;
    bias?: number | string | undefined;
    targetX?: number | string | undefined;
    targetY?: number | string | undefined;
    edgeMode?: "duplicate" | "wrap" | "none" | undefined;
    preserveAlpha?: boolean | "false" | "true" | undefined;
  }
  interface FeDiffuseLightingSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    surfaceScale?: number | string | undefined;
    diffuseConstant?: number | string | undefined;
    kernelUnitLength?: string | undefined;
  }
  interface FeDisplacementMapSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      DoubleInputFilterSVGAttributes,
      StylableSVGAttributes {
    scale?: number | string | undefined;
    xChannelSelector?: "R" | "G" | "B" | "A" | undefined;
    yChannelSelector?: "R" | "G" | "B" | "A" | undefined;
  }
  interface FeDistantLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    azimuth?: number | string | undefined;
    elevation?: number | string | undefined;
  }
  interface FeDropShadowSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {
    dx?: number | string | undefined;
    dy?: number | string | undefined;
    stdDeviation?: number | string | undefined;
  }
  interface FeFloodSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "flood-color" | "flood-opacity"> {}
  interface FeFuncSVGAttributes<T> extends CoreSVGAttributes<T> {
    type?: "identity" | "table" | "discrete" | "linear" | "gamma" | undefined;
    tableValues?: string | undefined;
    slope?: number | string | undefined;
    intercept?: number | string | undefined;
    amplitude?: number | string | undefined;
    exponent?: number | string | undefined;
    offset?: number | string | undefined;
  }
  interface FeGaussianBlurSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    stdDeviation?: number | string | undefined;
    edgeMode?: "duplicate" | "wrap" | "none" | undefined;
  }
  interface FeImageSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    preserveAspectRatio?: string | undefined;
    href?: string | undefined;
    xlinkHref?: string | undefined;
  }
  interface FeMergeSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes {}
  interface FeMergeNodeSVGAttributes<T> extends CoreSVGAttributes<T>, SingleInputFilterSVGAttributes {}
  interface FeMorphologySVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    operator?: "erode" | "dilate" | undefined;
    radius?: number | string | undefined;
  }
  interface FeOffsetSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {
    dx?: number | string | undefined;
    dy?: number | string | undefined;
  }
  interface FePointLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    x?: number | string | undefined;
    y?: number | string | undefined;
    z?: number | string | undefined;
  }
  interface FeSpecularLightingSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "lighting-color"> {
    surfaceScale?: number | string | undefined;
    specularConstant?: number | string | undefined;
    specularExponent?: number | string | undefined;
    kernelUnitLength?: string | undefined;
  }
  interface FeSpotLightSVGAttributes<T> extends LightSourceElementSVGAttributes<T> {
    x?: number | string | undefined;
    y?: number | string | undefined;
    z?: number | string | undefined;
    pointsAtX?: number | string | undefined;
    pointsAtY?: number | string | undefined;
    pointsAtZ?: number | string | undefined;
    specularExponent?: number | string | undefined;
    limitingConeAngle?: number | string | undefined;
  }
  interface FeTileSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      SingleInputFilterSVGAttributes,
      StylableSVGAttributes {}
  interface FeTurbulanceSVGAttributes<T>
    extends FilterPrimitiveElementSVGAttributes<T>,
      StylableSVGAttributes {
    baseFrequency?: string | undefined;
    numOctaves?: number | string | undefined;
    seed?: number | string | undefined;
    stitchTiles?: "stitch" | "noStitch" | undefined;
    type?: "fractalNoise" | "turbulence" | undefined;
  }
  interface FilterSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes {
    filterUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    primitiveUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
    filterRes?: string | undefined;
  }
  interface ForeignObjectSVGAttributes<T>
    extends NewViewportSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
  }
  interface GSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "display" | "visibility"> {}
  interface ImageSVGAttributes<T>
    extends NewViewportSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "color-profile" | "image-rendering"> {
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
    preserveAspectRatio?: string | undefined;
    href?: string | undefined;
    xlinkHref?: string | undefined;
  }
  interface LineSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    x1?: string | number | undefined;
    x2?: string | number | undefined;
    y1?: string | number | undefined;
    y2?: string | number | undefined;
  }
  interface LinearGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    x1?: string | number | undefined;
    x2?: string | number | undefined;
    y1?: string | number | undefined;
    y2?: string | number | undefined;
  }
  interface MarkerSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "overflow" | "clip"> {
    markerUnits?: "userSpaceOnUse" | "strokeWidth" | undefined;
    refX?: string | number | undefined;
    refY?: string | number | undefined;
    markerWidth?: string | number | undefined;
    markerHeight?: string | number | undefined;
    orient?: string | undefined;
  }
  interface MaskSVGAttributes<T>
    extends Omit<ContainerElementSVGAttributes<T>, "opacity" | "filter">,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path"> {
    maskUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    maskContentUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
  }
  interface MetadataSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface MPathSVGAttributes<T> extends CoreSVGAttributes<T> {}
  interface PathSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    d?: string | undefined;
    pathLength?: number | string | undefined;
  }
  interface PatternSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      FitToViewBoxSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "overflow" | "clip"> {
    patternUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    patternContentUnits?: "userSpaceOnUse" | "objectBoundingBox" | undefined;
    patternTransform?: string | undefined;
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
  }
  interface PolygonSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    points?: string | undefined;
  }
  interface PolylineSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    points?: string | undefined;
  }
  interface RadialGradientSVGAttributes<T> extends GradientElementSVGAttributes<T> {
    cx?: string | number | undefined;
    cy?: string | number | undefined;
    r?: string | number | undefined;
    fx?: string | number | undefined;
    fy?: string | number | undefined;
    fr?: string | number | undefined;
  }
  interface RectSVGAttributes<T>
    extends GraphicsElementSVGAttributes<T>,
      ShapeElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "marker-start" | "marker-mid" | "marker-end"> {
    x?: string | number | undefined;
    y?: string | number | undefined;
    width?: string | number | undefined;
    height?: string | number | undefined;
    rx?: string | number | undefined;
    ry?: string | number | undefined;
  }
  interface StopSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      StylableSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "stop-color" | "stop-opacity"> {
    offset?: string | number | undefined;
  }
  interface SvgSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      FitToViewBoxSVGAttributes,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      ZoomAndPanSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "color" | "display" | "image-rendering" | "shape-rendering" | "text-rendering"> {
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
    xmlns?: string | undefined;
    xmlnsXlink?: string | undefined;
  }
  interface SwitchSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "display" | "visibility"> {}
  interface SymbolSVGAttributes<T>
    extends ContainerElementSVGAttributes<T>,
      NewViewportSVGAttributes<T>,
      FitToViewBoxSVGAttributes,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      ZoomAndPanSVGAttributes,
      Pick<PresentationSVGAttributes, "color" | "display" | "direction" | "writing-mode"> {}
  interface TextSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "clip-path" | "color" | "direction" | "display" | "glyph-orientation-horizontal" | "glyph-orientation-vertical" | "letter-spacing" | "overflow" | "text-anchor" | "text-decoration" | "text-rendering" | "unicode-bidi" | "visibility" | "word-spacing" | "writing-mode"> {
    x?: string | number | undefined;
    y?: string | number | undefined;
    dx?: string | number | undefined;
    dy?: string | number | undefined;
    rotate?: string | number | undefined;
    textLength?: string | number | undefined;
    lengthAdjust?: "spacing" | "spacingAndGlyphs" | undefined;
  }
  interface TextPathSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "clip-path" | "color" | "direction" | "display" | "glyph-orientation-horizontal" | "glyph-orientation-vertical" | "letter-spacing" | "overflow" | "text-anchor" | "text-decoration" | "text-rendering" | "unicode-bidi" | "visibility" | "word-spacing" | "writing-mode"> {
    href?: string | undefined;
    xlinkHref?: string | undefined;
    startOffset?: string | number | undefined;
    method?: "align" | "stretch" | undefined;
    spacing?: "auto" | "exact" | undefined;
  }
  interface TSpanSVGAttributes<T>
    extends TextContentElementSVGAttributes<T>,
      Pick<PresentationSVGAttributes, "clip-path" | "color" | "direction" | "display" | "glyph-orientation-horizontal" | "glyph-orientation-vertical" | "letter-spacing" | "overflow" | "text-anchor" | "text-decoration" | "text-rendering" | "unicode-bidi" | "visibility" | "word-spacing" | "writing-mode"> {
    x?: string | number | undefined;
    y?: string | number | undefined;
    dx?: string | number | undefined;
    dy?: string | number | undefined;
    rotate?: string | number | undefined;
    textLength?: string | number | undefined;
    lengthAdjust?: "spacing" | "spacingAndGlyphs" | undefined;
  }
  interface UseSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      GraphicsElementSVGAttributes<T>,
      ConditionalProcessingSVGAttributes,
      ExternalResourceSVGAttributes,
      StylableSVGAttributes,
      TransformableSVGAttributes,
      Pick<PresentationSVGAttributes, "clip-path" | "color" | "display" | "overflow" | "visibility"> {
    x?: number | string | undefined;
    y?: number | string | undefined;
    width?: number | string | undefined;
    height?: number | string | undefined;
    href?: string | undefined;
    xlinkHref?: string | undefined;
  }
  interface ViewSVGAttributes<T>
    extends CoreSVGAttributes<T>,
      ExternalResourceSVGAttributes,
      FitToViewBoxSVGAttributes,
      ZoomAndPanSVGAttributes {
    viewTarget?: string | undefined;
  }

  // ---- MathML attributes ----

  interface MathMLAttributes<T> extends DOMAttributes<T> {
    dir?: "ltr" | "rtl" | undefined;
    displaystyle?: boolean | undefined;
    mathbackground?: string | undefined;
    mathcolor?: string | undefined;
    mathsize?: string | undefined;
    mathvariant?:
      | "normal"
      | "bold"
      | "italic"
      | "bold-italic"
      | "double-struck"
      | "bold-fraktur"
      | "script"
      | "bold-script"
      | "fraktur"
      | "sans-serif"
      | "bold-sans-serif"
      | "sans-serif-italic"
      | "sans-serif-bold-italic"
      | "monospace"
      | "initial"
      | "tailed"
      | "looped"
      | "stretched"
      | undefined;
    nonce?: string | undefined;
    scriptlevel?: number | string | undefined;
    tabindex?: number | string | undefined;
  }
  interface MathMLAnnotationElementAttributes<T> extends MathMLAttributes<T> {
    encoding?: string | undefined;
    src?: string | undefined;
  }
  interface MathMLAnnotationXmlElementAttributes<T> extends MathMLAttributes<T> {
    encoding?: string | undefined;
  }
  interface MathMLMathElementAttributes<T> extends MathMLAttributes<T> {
    display?: "block" | "inline" | undefined;
  }
  interface MathMLMerrorElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMfracElementAttributes<T> extends MathMLAttributes<T> {
    linethickness?: string | undefined;
    numalign?: "left" | "center" | "right" | undefined;
    denomalign?: "left" | "center" | "right" | undefined;
  }
  interface MathMLMiElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMmultiscriptsElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMnElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMoElementAttributes<T> extends MathMLAttributes<T> {
    accent?: boolean | undefined;
    fence?: boolean | undefined;
    largeop?: boolean | undefined;
    lspace?: string | undefined;
    maxsize?: string | undefined;
    minsize?: string | undefined;
    movablelimits?: boolean | undefined;
    rspace?: string | undefined;
    separator?: boolean | undefined;
    stretchy?: boolean | undefined;
    symmetric?: boolean | undefined;
  }
  interface MathMLMoverElementAttributes<T> extends MathMLAttributes<T> {
    accent?: boolean | undefined;
  }
  interface MathMLMpaddedElementAttributes<T> extends MathMLAttributes<T> {
    depth?: string | undefined;
    height?: string | undefined;
    lspace?: string | undefined;
    voffset?: string | undefined;
    width?: string | undefined;
  }
  interface MathMLMphantomElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMrootElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMrowElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMsElementAttributes<T> extends MathMLAttributes<T> {
    lquote?: string | undefined;
    rquote?: string | undefined;
  }
  interface MathMLMspaceElementAttributes<T> extends MathMLAttributes<T> {
    depth?: string | undefined;
    height?: string | undefined;
    width?: string | undefined;
  }
  interface MathMLMsqrtElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMstyleElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMsubElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMsubsupElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMsupElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMtableElementAttributes<T> extends MathMLAttributes<T> {
    align?: string | undefined;
    columnalign?: string | undefined;
    columnlines?: string | undefined;
    columnspacing?: string | undefined;
    displaystyle?: boolean | undefined;
    frame?: string | undefined;
    framespacing?: string | undefined;
    rowalign?: string | undefined;
    rowlines?: string | undefined;
    rowspacing?: string | undefined;
    width?: string | undefined;
  }
  interface MathMLMtdElementAttributes<T> extends MathMLAttributes<T> {
    columnalign?: string | undefined;
    columnspan?: number | undefined;
    rowalign?: string | undefined;
    rowspan?: number | undefined;
  }
  interface MathMLMtextElementAttributes<T> extends MathMLAttributes<T> {}
  interface MathMLMtrElementAttributes<T> extends MathMLAttributes<T> {
    columnalign?: string | undefined;
    rowalign?: string | undefined;
  }
  interface MathMLMunderElementAttributes<T> extends MathMLAttributes<T> {
    accentunder?: boolean | undefined;
  }
  interface MathMLMunderoverElementAttributes<T> extends MathMLAttributes<T> {
    accent?: boolean | undefined;
    accentunder?: boolean | undefined;
  }
  interface MathMLSemanticsElementAttributes<T> extends MathMLAttributes<T> {}

  // ---- tag maps ----

  interface HTMLElementTags {
    a: AnchorHTMLAttributes<HTMLAnchorElement>;
    abbr: HTMLAttributes<HTMLElement>;
    address: HTMLAttributes<HTMLElement>;
    area: AreaHTMLAttributes<HTMLAreaElement>;
    article: HTMLAttributes<HTMLElement>;
    aside: HTMLAttributes<HTMLElement>;
    audio: AudioHTMLAttributes<HTMLAudioElement>;
    b: HTMLAttributes<HTMLElement>;
    base: BaseHTMLAttributes<HTMLBaseElement>;
    bdi: HTMLAttributes<HTMLElement>;
    bdo: BdoHTMLAttributes<HTMLElement>;
    blockquote: BlockquoteHTMLAttributes<HTMLQuoteElement>;
    body: BodyHTMLAttributes<HTMLBodyElement>;
    br: HTMLAttributes<HTMLBRElement>;
    button: ButtonHTMLAttributes<HTMLButtonElement>;
    canvas: CanvasHTMLAttributes<HTMLCanvasElement>;
    caption: CaptionHTMLAttributes<HTMLTableCaptionElement>;
    cite: HTMLAttributes<HTMLElement>;
    code: HTMLAttributes<HTMLElement>;
    col: ColHTMLAttributes<HTMLTableColElement>;
    colgroup: ColgroupHTMLAttributes<HTMLTableColElement>;
    data: DataHTMLAttributes<HTMLDataElement>;
    datalist: HTMLAttributes<HTMLDataListElement>;
    dd: HTMLAttributes<HTMLElement>;
    del: DelHTMLAttributes<HTMLElement>;
    details: DetailsHTMLAttributes<HTMLElement>;
    dfn: HTMLAttributes<HTMLElement>;
    dialog: DialogHTMLAttributes<HTMLDialogElement>;
    div: HTMLAttributes<HTMLDivElement>;
    dl: HTMLAttributes<HTMLDListElement>;
    dt: HTMLAttributes<HTMLElement>;
    em: HTMLAttributes<HTMLElement>;
    embed: EmbedHTMLAttributes<HTMLEmbedElement>;
    fieldset: FieldsetHTMLAttributes<HTMLFieldSetElement>;
    figcaption: HTMLAttributes<HTMLElement>;
    figure: HTMLAttributes<HTMLElement>;
    footer: HTMLAttributes<HTMLElement>;
    form: FormHTMLAttributes<HTMLFormElement>;
    h1: HTMLAttributes<HTMLHeadingElement>;
    h2: HTMLAttributes<HTMLHeadingElement>;
    h3: HTMLAttributes<HTMLHeadingElement>;
    h4: HTMLAttributes<HTMLHeadingElement>;
    h5: HTMLAttributes<HTMLHeadingElement>;
    h6: HTMLAttributes<HTMLHeadingElement>;
    head: HTMLAttributes<HTMLHeadElement>;
    header: HTMLAttributes<HTMLElement>;
    hgroup: HTMLAttributes<HTMLElement>;
    hr: HTMLAttributes<HTMLHRElement>;
    html: HtmlHTMLAttributes<HTMLHtmlElement>;
    i: HTMLAttributes<HTMLElement>;
    iframe: IframeHTMLAttributes<HTMLIFrameElement>;
    img: ImgHTMLAttributes<HTMLImageElement>;
    input: InputHTMLAttributes<HTMLInputElement>;
    ins: InsHTMLAttributes<HTMLModElement>;
    kbd: HTMLAttributes<HTMLElement>;
    keygen: KeygenHTMLAttributes<HTMLElement>;
    label: LabelHTMLAttributes<HTMLLabelElement>;
    legend: HTMLAttributes<HTMLLegendElement>;
    li: LiHTMLAttributes<HTMLLIElement>;
    link: LinkHTMLAttributes<HTMLLinkElement>;
    main: HTMLAttributes<HTMLElement>;
    map: MapHTMLAttributes<HTMLMapElement>;
    mark: HTMLAttributes<HTMLElement>;
    menu: MenuHTMLAttributes<HTMLElement>;
    meta: MetaHTMLAttributes<HTMLMetaElement>;
    meter: MeterHTMLAttributes<HTMLElement>;
    nav: HTMLAttributes<HTMLElement>;
    noscript: HTMLAttributes<HTMLElement>;
    object: ObjectHTMLAttributes<HTMLObjectElement>;
    ol: OlHTMLAttributes<HTMLOListElement>;
    optgroup: OptgroupHTMLAttributes<HTMLOptGroupElement>;
    option: OptionHTMLAttributes<HTMLOptionElement>;
    output: OutputHTMLAttributes<HTMLOutputElement>;
    p: HTMLAttributes<HTMLParagraphElement>;
    param: ParamHTMLAttributes<HTMLParamElement>;
    picture: HTMLAttributes<HTMLElement>;
    pre: HTMLAttributes<HTMLPreElement>;
    progress: ProgressHTMLAttributes<HTMLProgressElement>;
    q: QuoteHTMLAttributes<HTMLQuoteElement>;
    rp: HTMLAttributes<HTMLElement>;
    rt: HTMLAttributes<HTMLElement>;
    ruby: HTMLAttributes<HTMLElement>;
    s: HTMLAttributes<HTMLElement>;
    samp: HTMLAttributes<HTMLElement>;
    script: ScriptHTMLAttributes<HTMLScriptElement>;
    search: HTMLAttributes<HTMLElement>;
    section: HTMLAttributes<HTMLElement>;
    select: SelectHTMLAttributes<HTMLSelectElement>;
    slot: SlotHTMLAttributes<HTMLSlotElement>;
    small: HTMLAttributes<HTMLElement>;
    source: SourceHTMLAttributes<HTMLSourceElement>;
    span: HTMLAttributes<HTMLSpanElement>;
    strong: HTMLAttributes<HTMLElement>;
    style: StyleHTMLAttributes<HTMLStyleElement>;
    sub: HTMLAttributes<HTMLElement>;
    summary: HTMLAttributes<HTMLElement>;
    sup: HTMLAttributes<HTMLElement>;
    table: TableHTMLAttributes<HTMLTableElement>;
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    td: TdHTMLAttributes<HTMLTableDataCellElement>;
    template: HTMLAttributes<HTMLTemplateElement>;
    textarea: TextareaHTMLAttributes<HTMLTextAreaElement>;
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    th: ThHTMLAttributes<HTMLTableHeaderCellElement>;
    thead: HTMLAttributes<HTMLTableSectionElement>;
    time: TimeHTMLAttributes<HTMLTimeElement>;
    title: HTMLAttributes<HTMLTitleElement>;
    tr: HTMLAttributes<HTMLTableRowElement>;
    track: TrackHTMLAttributes<HTMLTrackElement>;
    u: HTMLAttributes<HTMLElement>;
    ul: HTMLAttributes<HTMLUListElement>;
    var: HTMLAttributes<HTMLElement>;
    video: VideoHTMLAttributes<HTMLVideoElement>;
    wbr: HTMLAttributes<HTMLElement>;
  }

  interface HTMLElementDeprecatedTags {
    big: HTMLAttributes<HTMLElement>;
    center: HTMLAttributes<HTMLElement>;
    font: HTMLAttributes<HTMLElement>;
    marquee: HTMLAttributes<HTMLElement>;
    menuitem: HTMLAttributes<HTMLElement>;
    nobr: HTMLAttributes<HTMLElement>;
    noembed: HTMLAttributes<HTMLElement>;
    noframes: HTMLAttributes<HTMLElement>;
    param: ParamHTMLAttributes<HTMLParamElement>;
    strike: HTMLAttributes<HTMLElement>;
    tt: HTMLAttributes<HTMLElement>;
    xmp: HTMLAttributes<HTMLElement>;
  }

  interface SVGElementTags {
    animate: AnimateSVGAttributes<SVGAnimateElement>;
    animateMotion: AnimateMotionSVGAttributes<SVGAnimateMotionElement>;
    animateTransform: AnimateTransformSVGAttributes<SVGAnimateTransformElement>;
    circle: CircleSVGAttributes<SVGCircleElement>;
    clipPath: ClipPathSVGAttributes<SVGClipPathElement>;
    defs: DefsSVGAttributes<SVGDefsElement>;
    desc: DescSVGAttributes<SVGDescElement>;
    ellipse: EllipseSVGAttributes<SVGEllipseElement>;
    feBlend: FeBlendSVGAttributes<SVGFEBlendElement>;
    feColorMatrix: FeColorMatrixSVGAttributes<SVGFEColorMatrixElement>;
    feComponentTransfer: FeComponentTransferSVGAttributes<SVGFEComponentTransferElement>;
    feComposite: FeCompositeSVGAttributes<SVGFECompositeElement>;
    feConvolveMatrix: FeConvolveMatrixSVGAttributes<SVGFEConvolveMatrixElement>;
    feDiffuseLighting: FeDiffuseLightingSVGAttributes<SVGFEDiffuseLightingElement>;
    feDisplacementMap: FeDisplacementMapSVGAttributes<SVGFEDisplacementMapElement>;
    feDistantLight: FeDistantLightSVGAttributes<SVGFEDistantLightElement>;
    feDropShadow: FeDropShadowSVGAttributes<SVGFEDropShadowElement>;
    feFlood: FeFloodSVGAttributes<SVGFEFloodElement>;
    feFuncA: FeFuncSVGAttributes<SVGFEFuncAElement>;
    feFuncB: FeFuncSVGAttributes<SVGFEFuncBElement>;
    feFuncG: FeFuncSVGAttributes<SVGFEFuncGElement>;
    feFuncR: FeFuncSVGAttributes<SVGFEFuncRElement>;
    feGaussianBlur: FeGaussianBlurSVGAttributes<SVGFEGaussianBlurElement>;
    feImage: FeImageSVGAttributes<SVGFEImageElement>;
    feMerge: FeMergeSVGAttributes<SVGFEMergeElement>;
    feMergeNode: FeMergeNodeSVGAttributes<SVGFEMergeNodeElement>;
    feMorphology: FeMorphologySVGAttributes<SVGFEMorphologyElement>;
    feOffset: FeOffsetSVGAttributes<SVGFEOffsetElement>;
    fePointLight: FePointLightSVGAttributes<SVGFEPointLightElement>;
    feSpecularLighting: FeSpecularLightingSVGAttributes<SVGFESpecularLightingElement>;
    feSpotLight: FeSpotLightSVGAttributes<SVGFESpotLightElement>;
    feTile: FeTileSVGAttributes<SVGFETileElement>;
    feTurbulence: FeTurbulanceSVGAttributes<SVGFETurbulenceElement>;
    filter: FilterSVGAttributes<SVGFilterElement>;
    foreignObject: ForeignObjectSVGAttributes<SVGForeignObjectElement>;
    g: GSVGAttributes<SVGGElement>;
    image: ImageSVGAttributes<SVGImageElement>;
    line: LineSVGAttributes<SVGLineElement>;
    linearGradient: LinearGradientSVGAttributes<SVGLinearGradientElement>;
    marker: MarkerSVGAttributes<SVGMarkerElement>;
    mask: MaskSVGAttributes<SVGMaskElement>;
    metadata: MetadataSVGAttributes<SVGMetadataElement>;
    mpath: MPathSVGAttributes<SVGElement>;
    path: PathSVGAttributes<SVGPathElement>;
    pattern: PatternSVGAttributes<SVGPatternElement>;
    polygon: PolygonSVGAttributes<SVGPolygonElement>;
    polyline: PolylineSVGAttributes<SVGPolylineElement>;
    radialGradient: RadialGradientSVGAttributes<SVGRadialGradientElement>;
    rect: RectSVGAttributes<SVGRectElement>;
    stop: StopSVGAttributes<SVGStopElement>;
    svg: SvgSVGAttributes<SVGSVGElement>;
    switch: SwitchSVGAttributes<SVGSwitchElement>;
    symbol: SymbolSVGAttributes<SVGSymbolElement>;
    text: TextSVGAttributes<SVGTextElement>;
    textPath: TextPathSVGAttributes<SVGTextPathElement>;
    tspan: TSpanSVGAttributes<SVGTSpanElement>;
    use: UseSVGAttributes<SVGUseElement>;
    view: ViewSVGAttributes<SVGViewElement>;
  }

  interface MathMLElementTags {
    annotation: MathMLAnnotationElementAttributes<MathMLElement>;
    "annotation-xml": MathMLAnnotationXmlElementAttributes<MathMLElement>;
    math: MathMLMathElementAttributes<MathMLElement>;
    merror: MathMLMerrorElementAttributes<MathMLElement>;
    mfrac: MathMLMfracElementAttributes<MathMLElement>;
    mi: MathMLMiElementAttributes<MathMLElement>;
    mmultiscripts: MathMLMmultiscriptsElementAttributes<MathMLElement>;
    mn: MathMLMnElementAttributes<MathMLElement>;
    mo: MathMLMoElementAttributes<MathMLElement>;
    mover: MathMLMoverElementAttributes<MathMLElement>;
    mpadded: MathMLMpaddedElementAttributes<MathMLElement>;
    mphantom: MathMLMphantomElementAttributes<MathMLElement>;
    mroot: MathMLMrootElementAttributes<MathMLElement>;
    mrow: MathMLMrowElementAttributes<MathMLElement>;
    ms: MathMLMsElementAttributes<MathMLElement>;
    mspace: MathMLMspaceElementAttributes<MathMLElement>;
    msqrt: MathMLMsqrtElementAttributes<MathMLElement>;
    mstyle: MathMLMstyleElementAttributes<MathMLElement>;
    msub: MathMLMsubElementAttributes<MathMLElement>;
    msubsup: MathMLMsubsupElementAttributes<MathMLElement>;
    msup: MathMLMsupElementAttributes<MathMLElement>;
    mtable: MathMLMtableElementAttributes<MathMLElement>;
    mtd: MathMLMtdElementAttributes<MathMLElement>;
    mtext: MathMLMtextElementAttributes<MathMLElement>;
    mtr: MathMLMtrElementAttributes<MathMLElement>;
    munder: MathMLMunderElementAttributes<MathMLElement>;
    munderover: MathMLMunderoverElementAttributes<MathMLElement>;
    semantics: MathMLSemanticsElementAttributes<MathMLElement>;
  }

  interface IntrinsicElements
    extends HTMLElementTags,
      HTMLElementDeprecatedTags,
      SVGElementTags,
      MathMLElementTags {}
}

// ---- the generic `e` runtime function ----

/**
 * Wrap every property of `T` so it accepts either a plain value or a reactive
 * accessor. TSDML compiles function-valued props into `() => expr` thunks, so
 * `class` may be `string` or `() => string`, `onClick` may be a handler or a
 * `() => handler`, etc.
 */
export type MaybeProps<T> = { [K in keyof T]: FunctionMaybe<T[K]> };

/**
 * The type of the `e` runtime function. `K` is constrained to
 * `keyof DML.IntrinsicElements`, so the editor suggests every known tag and
 * type-checks the props against that tag's attributes (each prop also accepts
 * a reactive accessor via `MaybeProps`).
 */
export type E = <K extends keyof DML.IntrinsicElements>(
  tag: K,
  props?: MaybeProps<DML.IntrinsicElements[K]> | null,
  children?: Children,
) => Element;

/**
 * Create an element. The tag literal drives prop inference:
 *
 *   e("div", { class: "x", onClick: (e) => e.clientX })
 *
 * `K` is constrained to `keyof DML.IntrinsicElements`, so the editor suggests
 * every known tag and type-checks the props against that tag's attributes.
 * Props and children accept `FunctionMaybe<T>` so reactive accessors work.
 */
export const e: E;
