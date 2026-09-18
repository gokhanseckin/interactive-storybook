Pod::Spec.new do |s|
 s.name = 'StoryStorage'
 s.version = '1.0.0'
 s.summary = 'Persistent media excluded from backup and constrained-network policy'
 s.description = s.summary
 s.license = 'MIT'
 s.author = 'Masal Yolu'
 s.homepage = 'https://example.invalid'
 s.platforms = { :ios => '16.4' }
 s.source = { git: '' }
 s.static_framework = true
 s.dependency 'ExpoModulesCore'
 s.source_files = '**/*.{h,m,mm,swift}'
end
