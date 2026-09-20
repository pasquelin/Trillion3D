import { Stat, StatGroup } from '../components/Stats.jsx';

export function EngineStats({ copy }) {
  return (
    <div className="scene-stats" aria-label={copy.stats}>
      <StatGroup className="scene-stat-pair">
        <Stat
          title={copy.selected}
          description={copy.selectedDesc}
          valueProps={{ 'data-scene-selected': '' }}
        >
          —
        </Stat>
        <Stat
          title={copy.drawn}
          description={copy.drawnDesc}
          valueProps={{ 'data-scene-drawn': '' }}
        >
          —
        </Stat>
      </StatGroup>
      <StatGroup className="scene-stat-times">
        <Stat title={copy.fps} description={copy.fpsDesc} valueProps={{ 'data-scene-fps': '' }}>
          {copy.idle}
        </Stat>
        <Stat title={copy.cpu} description={copy.cpuDesc} valueProps={{ 'data-scene-cpu': '' }}>
          —
        </Stat>
        <Stat title={copy.gpu} description={copy.gpuDesc} valueProps={{ 'data-scene-gpu': '' }}>
          —
        </Stat>
      </StatGroup>
      <StatGroup className="scene-stat-pair">
        <Stat
          title={copy.geometryMemory}
          description={copy.geometryMemoryDesc}
          valueProps={{ 'data-scene-geometry-memory': '' }}
          descriptionProps={{ 'data-scene-geometry-budget': '' }}
        >
          —
        </Stat>
        <Stat
          title={copy.textureMemory}
          description={copy.textureMemoryDesc}
          valueProps={{ 'data-scene-texture-memory': '' }}
          descriptionProps={{ 'data-scene-texture-budget': '' }}
        >
          —
        </Stat>
      </StatGroup>
    </div>
  );
}
