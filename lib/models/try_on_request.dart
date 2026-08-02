import 'outfit_plan.dart';
import 'product.dart';
import 'user_profile.dart';
import 'virtual_model.dart';

/// AI 穿搭页跳转到虚拟模特页时使用的完整试穿会话。
class TryOnRequest {
  const TryOnRequest({
    required this.userId,
    required this.virtualModel,
    required this.products,
    required this.outfitPlan,
    required this.userProfile,
    required this.userImage,
    required this.createdTime,
  });

  final String userId;
  final VirtualModel virtualModel;
  final List<Product> products;
  final OutfitPlan outfitPlan;
  final UserProfile userProfile;
  final String userImage;
  final DateTime createdTime;

  Product get product => products.first;

  TryOnRequest copyWith({
    String? userId,
    VirtualModel? virtualModel,
    List<Product>? products,
    OutfitPlan? outfitPlan,
    UserProfile? userProfile,
    String? userImage,
    DateTime? createdTime,
  }) {
    return TryOnRequest(
      userId: userId ?? this.userId,
      virtualModel: virtualModel ?? this.virtualModel,
      products: products ?? this.products,
      outfitPlan: outfitPlan ?? this.outfitPlan,
      userProfile: userProfile ?? this.userProfile,
      userImage: userImage ?? this.userImage,
      createdTime: createdTime ?? this.createdTime,
    );
  }

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'virtualModel': virtualModel.toJson(),
        'products': products.map((product) => product.toJson()).toList(),
        'outfitPlan': outfitPlan.toJson(),
        'userProfile': userProfile.toJson(),
        'userImage': userImage,
        'createdTime': createdTime.toIso8601String(),
      };
}
