/// Nothing yet: a native client has no browser of its own to hand a URL to, and adding one is a
/// dependency (url_launcher) that would arrive with a platform channel per platform.
///
/// Returns false so a caller can say "copy this address instead" rather than pretending it worked —
/// the download list does exactly that.
library;

bool openLink(String url) => false;
