import 'package:flutter/foundation.dart';

enum AppLogLevel { info, warning, error }

class AppLogEntry {
  const AppLogEntry({
    required this.level,
    required this.event,
    required this.createdAt,
    required this.metadata,
  });

  final AppLogLevel level;
  final String event;
  final DateTime createdAt;
  final Map<String, Object?> metadata;
}

class AppLogger {
  AppLogger._();

  static final AppLogger instance = AppLogger._();
  static const _maxEntries = 200;
  final List<AppLogEntry> _entries = [];

  List<AppLogEntry> get entries => List.unmodifiable(_entries);

  void info(String event, {Map<String, Object?> metadata = const {}}) {
    _write(AppLogLevel.info, event, metadata);
  }

  void warning(String event, {Map<String, Object?> metadata = const {}}) {
    _write(AppLogLevel.warning, event, metadata);
  }

  void error(
    String event, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?> metadata = const {},
  }) {
    _write(
      AppLogLevel.error,
      event,
      {
        ...metadata,
        if (error != null) 'errorType': error.runtimeType.toString(),
        if (stackTrace != null) 'hasStackTrace': true,
      },
    );
  }

  void clear() => _entries.clear();

  void _write(
    AppLogLevel level,
    String event,
    Map<String, Object?> metadata,
  ) {
    final safeMetadata = _redactMap(metadata);
    final entry = AppLogEntry(
      level: level,
      event: event,
      createdAt: DateTime.now(),
      metadata: safeMetadata,
    );
    _entries.insert(0, entry);
    if (_entries.length > _maxEntries) {
      _entries.removeRange(_maxEntries, _entries.length);
    }
    if (kDebugMode) {
      debugPrint('[Shupi][${level.name}] $event $safeMetadata');
    }
  }

  Map<String, Object?> _redactMap(Map<String, Object?> input) {
    return {
      for (final entry in input.entries)
        entry.key:
            _isSensitive(entry.key) ? '[REDACTED]' : _redactValue(entry.value),
    };
  }

  Object? _redactValue(Object? value) {
    if (value is Map<String, Object?>) {
      return _redactMap(value);
    }
    if (value is Iterable) {
      return value.map(_redactValue).toList(growable: false);
    }
    if (value is String &&
        (value.startsWith('data:image') || value.length > 2000)) {
      return '[REDACTED]';
    }
    return value;
  }

  bool _isSensitive(String key) {
    final normalized = key.toLowerCase();
    return const [
      'password',
      'token',
      'base64',
      'image',
      'photo',
      'avatar',
      'authorization',
    ].any(normalized.contains);
  }
}
