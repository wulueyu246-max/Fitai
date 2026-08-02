import '../models/outfit.dart';
import '../models/avatar.dart';
import '../models/product.dart';
import '../models/try_on_request.dart';
import '../models/try_on_result.dart';
import '../models/virtual_model.dart';
import '../models/virtual_try_on_task.dart';

abstract interface class VirtualTryOnService {
  Future<VirtualTryOnTask> createTask(TryOnRequest request);

  Future<VirtualTryOnTask> getStatus(String taskId);

  Future<TryOnResult> getResult(String taskId);

  Future<VirtualModel> generateVirtualModel(Outfit outfit);

  Future<VirtualTryOnTask> generateTryOnImage(TryOnRequest request);

  Future<VirtualTryOnTask> checkStatus(String taskId);

  /// Backward-compatible facade for the first-stage app flow.
  Future<VirtualModel> createModel(Outfit outfit);

  Future<VirtualModel> tryOn({
    required VirtualModel model,
    required Product product,
  });

  Future<TryOnResult> generateTryOn(TryOnRequest request);
}

class MockVirtualTryOnService implements VirtualTryOnService {
  const MockVirtualTryOnService({
    this.delay = const Duration(milliseconds: 360),
    this.generationDelay = const Duration(seconds: 2),
    this.resultImage = 'assets/images/home/business_commute.jpg',
  });

  final Duration delay;
  final Duration generationDelay;
  final String resultImage;
  static final Map<String, _MockTryOnJob> _jobs = {};
  static final Map<String, VirtualTryOnTask> _completedTasks = {};

  @override
  Future<VirtualTryOnTask> createTask(TryOnRequest request) {
    return generateTryOnImage(request);
  }

  @override
  Future<VirtualTryOnTask> getStatus(String taskId) {
    return checkStatus(taskId);
  }

  @override
  Future<TryOnResult> getResult(String taskId) async {
    final task = _completedTasks[taskId] ?? await checkStatus(taskId);
    if (task.status != VirtualTryOnTaskStatus.success ||
        task.imageUrl == null) {
      throw StateError(task.error ?? '试穿结果尚未生成');
    }
    return TryOnResult(
      id: task.id,
      image: task.imageUrl!,
      createdTime: DateTime.now(),
      isMock: task.isMock,
    );
  }

  @override
  Future<VirtualModel> generateVirtualModel(Outfit outfit) async {
    await _waitForMockDelay();

    final now = DateTime.now();
    final bodyProportion = _bodyProportion(outfit);
    final avatar = Avatar(
      id: 'mock-avatar-${now.microsecondsSinceEpoch}',
      userId: outfit.userId,
      photoBindings: Map.unmodifiable(outfit.userImages),
      faceShape: '柔和椭圆',
      hairstyle: '利落短发',
      skinTone: '自然中性',
      bodyProportion: bodyProportion,
      createdAt: now,
    );
    return VirtualModel(
      id: 'mock-model-${now.microsecondsSinceEpoch}',
      avatarImage: outfit.userImages['front'],
      avatar: avatar,
      hairstyle: '利落短发',
      faceShape: '柔和椭圆',
      bodyProportion: bodyProportion,
      skinTone: '自然中性',
      outfit: outfit,
    );
  }

  @override
  Future<VirtualModel> createModel(Outfit outfit) async {
    return generateVirtualModel(outfit);
  }

  @override
  Future<VirtualModel> tryOn({
    required VirtualModel model,
    required Product product,
  }) async {
    await _waitForMockDelay();
    return model.copyWith(outfit: model.outfit.replaceProduct(product));
  }

  @override
  Future<TryOnResult> generateTryOn(TryOnRequest request) async {
    var task = await generateTryOnImage(request);
    while (!task.isComplete) {
      await Future<void>.delayed(const Duration(milliseconds: 200));
      task = await checkStatus(task.id);
    }
    if (task.status == VirtualTryOnTaskStatus.failed || task.imageUrl == null) {
      throw StateError(task.error ?? 'Mock 试穿任务失败');
    }

    return TryOnResult(
      id: task.id,
      image: task.imageUrl!,
      createdTime: DateTime.now(),
      isMock: task.isMock,
    );
  }

  @override
  Future<VirtualTryOnTask> generateTryOnImage(TryOnRequest request) async {
    final createdTime = DateTime.now();
    final id = 'mock-try-on-${createdTime.microsecondsSinceEpoch}';
    _jobs[id] = _MockTryOnJob(
      createdTime: createdTime,
      delay: generationDelay,
      resultImage: resultImage,
    );
    return VirtualTryOnTask(
      id: id,
      status: VirtualTryOnTaskStatus.waiting,
      createdTime: createdTime,
      isMock: true,
      progress: 0,
      provider: 'fitai-mock',
    );
  }

  @override
  Future<VirtualTryOnTask> checkStatus(String taskId) async {
    final job = _jobs[taskId];
    if (job == null) {
      return VirtualTryOnTask(
        id: taskId,
        status: VirtualTryOnTaskStatus.failed,
        createdTime: DateTime.now(),
        error: '试穿任务不存在或已过期',
        isMock: true,
      );
    }

    if (job.remainingChecks > 1) {
      job.remainingChecks -= 1;
      return VirtualTryOnTask(
        id: taskId,
        status: VirtualTryOnTaskStatus.generating,
        createdTime: job.createdTime,
        isMock: true,
        progress: 0.55,
        provider: 'fitai-mock',
      );
    }

    _jobs.remove(taskId);
    final completed = VirtualTryOnTask(
      id: taskId,
      status: VirtualTryOnTaskStatus.success,
      createdTime: job.createdTime,
      imageUrl: job.resultImage,
      isMock: true,
      progress: 1,
      provider: 'fitai-mock',
    );
    _completedTasks[taskId] = completed;
    return completed;
  }

  Future<void> _waitForMockDelay() {
    if (delay == Duration.zero) {
      return Future<void>.value();
    }

    return Future<void>.delayed(delay);
  }

  String _bodyProportion(Outfit outfit) {
    final ratio = outfit.height / outfit.weight;

    if (ratio >= 3) {
      return '修长比例';
    }

    if (ratio <= 2.3) {
      return '稳健比例';
    }

    return '均衡比例';
  }
}

class _MockTryOnJob {
  _MockTryOnJob({
    required this.createdTime,
    required Duration delay,
    required this.resultImage,
  }) : remainingChecks =
            delay == Duration.zero ? 1 : (delay.inMilliseconds / 250).ceil();

  final DateTime createdTime;
  final String resultImage;
  int remainingChecks;
}
