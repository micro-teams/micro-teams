/// How far past each edge of the viewport a scrollable pre-lays-out and pre-paints its children.
///
/// Flutter's own default is 250 logical pixels — well under one screen on any phone — so a fast
/// flick easily outruns what has been prepared and lands on frames of freshly-built content, which
/// is when a scroll visibly stutters. Expressed as a multiple of the viewport rather than a pixel
/// count on purpose: the number that matters is "how many screens ahead", and a tall phone and a
/// short one do not want the same pixel figure.
///
/// The cost is memory: those extra children are kept laid out and rasterised (a builder gives each
/// one its own RepaintBoundary by default), so this buys smoothness with RAM. Two screens either
/// side is the usual sweet spot — enough that an ordinary fling never reaches the edge of what is
/// ready, without holding a whole conversation in memory.
library;

import 'package:flutter/rendering.dart';

const ScrollCacheExtent smoothCacheExtent = ScrollCacheExtent.viewport(2);
